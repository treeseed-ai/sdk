import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	localComposeDriftReasons,
	localComposeRuntimeConfigDrift,
	localComposeRuntimeImageDrift,
	localComposeReconciledSpecHash,
	localComposeRequiredPathWarnings,
	localComposeServiceReady,
	observeLocalComposeRequiredPaths,
	parseLocalComposeServices,
	parseLocalComposeConfigHashes,
	waitForLocalComposeServices,
} from '../../../../src/reconcile/runtime/local-compose-state.ts';
import { validateAndDigestCapacityProviderManifest } from '../../../../src/capacity-provider/config/manifest.ts';

function persisted(overrides: Record<string, unknown> = {}) {
	return {
		desiredSpecHash: 'old-spec',
		lastReconciledAt: '2026-07-17T00:00:00.000Z',
		lastReconciledState: { configHash: 'old-config', requiredPaths: [] },
		...overrides,
	} as any;
}

describe('local Docker Compose exact-state helpers', () => {
	it('fails required host paths closed and validates their type', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-local-compose-paths-'));
		const manifest = join(root, 'treeseed.capacity-provider.yaml');
		const missing = observeLocalComposeRequiredPaths([
			{ path: 'treeseed.capacity-provider.yaml', kind: 'file', description: 'Capacity provider manifest' },
		], root);
		expect(missing[0]).toMatchObject({ path: manifest, exists: false, valid: false });
		expect(localComposeRequiredPathWarnings(missing)).toEqual([
			`Capacity provider manifest is missing or is not a file: ${manifest}`,
		]);

		mkdirSync(manifest);
		expect(observeLocalComposeRequiredPaths([{ path: manifest, kind: 'file' }], root)[0]?.valid).toBe(false);
		const file = join(root, 'provider.yaml');
		writeFileSync(file, 'schemaVersion: 2\n');
		expect(observeLocalComposeRequiredPaths([{ path: file, kind: 'file' }], root)[0]?.valid).toBe(true);
	});

	it('forces updates for desired, rendered-config, and newly governed host-path drift', () => {
		const requiredPaths = [{ path: '/provider.yaml', kind: 'file', description: 'manifest', exists: true, valid: true }] as const;
		expect(localComposeDriftReasons({
			persistedState: persisted({ lastReconciledState: { configHash: 'new-config' } }),
			desiredSpecHash: 'new-spec',
			configHash: 'new-config',
			requiredPaths: [...requiredPaths],
		})).toEqual([
			'compose desired specification changed',
			'required host path contract has not been reconciled',
		]);
		expect(localComposeDriftReasons({
			persistedState: persisted({ desiredSpecHash: 'new-spec', lastReconciledState: { requiredPaths } }),
			desiredSpecHash: 'new-spec',
			configHash: 'new-config',
			requiredPaths: [...requiredPaths],
		})).toEqual(['rendered compose configuration has not been reconciled']);
		expect(localComposeDriftReasons({
			persistedState: persisted({ desiredSpecHash: 'new-spec', lastReconciledState: { configHash: 'old-config', requiredPaths } }),
			desiredSpecHash: 'new-spec',
			configHash: 'new-config',
			requiredPaths: [...requiredPaths],
		})).toEqual(['rendered compose configuration changed']);
	});

	it('parses both array and line-delimited compose status and rejects unhealthy services', () => {
		const array = parseLocalComposeServices(JSON.stringify([
			{ Service: 'manager', State: 'running', Health: 'healthy', Labels: 'other=value,com.docker.compose.config-hash=manager-hash' },
			{ Service: 'runner', State: 'exited', Health: '' },
		]));
		expect(localComposeServiceReady(array.find((entry) => entry.service === 'manager'))).toBe(true);
		expect(array[0]?.configHash).toBe('manager-hash');
		expect(localComposeServiceReady(array.find((entry) => entry.service === 'runner'))).toBe(false);
		const lines = parseLocalComposeServices('{"Service":"manager","State":"running"}\n{"Service":"runner","State":"running","Health":"unhealthy"}');
		expect(localComposeServiceReady(lines[0])).toBe(true);
		expect(localComposeServiceReady(lines[1])).toBe(false);
	});

	it('detects running containers created from stale rendered compose configuration', () => {
		const rendered = 'manager desired-manager\nrunner desired-runner';
		expect(parseLocalComposeConfigHashes(rendered)).toEqual(new Map([
			['manager', 'desired-manager'],
			['runner', 'desired-runner'],
		]));
		const services = parseLocalComposeServices(JSON.stringify([
			{ Service: 'manager', State: 'running', Labels: 'com.docker.compose.config-hash=old-manager' },
			{ Service: 'runner', State: 'running', Labels: { 'com.docker.compose.config-hash': 'desired-runner' } },
		]));
		expect(localComposeRuntimeConfigDrift(rendered, services)).toEqual([
			'running compose service manager uses stale rendered configuration',
		]);
		expect(localComposeDriftReasons({
			persistedState: persisted({
				desiredSpecHash: 'new-spec',
				lastReconciledState: { configHash: rendered, requiredPaths: [] },
			}),
			desiredSpecHash: 'new-spec',
			configHash: rendered,
			services,
			requiredPaths: [],
		})).toEqual([
			'running compose service manager uses stale rendered configuration',
		]);
	});

	it('detects a running service whose mutable local tag now resolves to a newer image', () => {
		const services = parseLocalComposeServices(JSON.stringify([
			{ Service: 'manager', State: 'running', Image: 'sha256:old-manager' },
			{ Service: 'runner', State: 'running', Labels: { 'com.docker.compose.image': 'sha256:current-runner' } },
		]));
		expect(localComposeRuntimeImageDrift({
			manager: 'sha256:current-manager',
			runner: 'sha256:current-runner',
		}, services)).toEqual([
			'running compose service manager uses stale image sha256:old-manager; expected sha256:current-manager',
		]);
		expect(localComposeDriftReasons({
			persistedState: persisted({ desiredSpecHash: 'new-spec', lastReconciledState: { configHash: null, requiredPaths: [] } }),
			desiredSpecHash: 'new-spec',
			configHash: null,
			services,
			desiredImageIds: { manager: 'sha256:current-manager', runner: 'sha256:current-runner' },
			requiredPaths: [],
		})).toEqual([
			'running compose service manager uses stale image sha256:old-manager; expected sha256:current-manager',
		]);
	});

	it('waits through a bounded starting state until every declared service is healthy', async () => {
		const observations = [
			[{ service: 'postgres', state: 'running', health: 'starting', configHash: null }],
			[{ service: 'postgres', state: 'running', health: 'healthy', configHash: null }],
		];
		let index = 0;
		const result = await waitForLocalComposeServices({
			serviceNames: ['postgres'],
			observe: () => observations[Math.min(index++, observations.length - 1)]!,
			attempts: 3,
			intervalMs: 100,
			wait: async () => {},
		});
		expect(result).toMatchObject({ ready: true, attempts: 2 });
	});

	it('excludes one-shot reset directives from the reconciled desired-state hash', () => {
		const base = { projectName: 'test', env: { PORT: '1234' } };
		expect(localComposeReconciledSpecHash(base)).toBe(localComposeReconciledSpecHash({
			...base,
			resetData: true,
			forceRecreate: true,
		}));
		expect(localComposeReconciledSpecHash(base)).not.toBe(localComposeReconciledSpecHash({
			...base,
			env: { PORT: '5678' },
		}));
	});

	it('derives stable validated provider-manifest digests that force compose specification drift', () => {
		const manifest = {
			schemaVersion: 2 as const,
			providerClass: 'agent' as const,
			ownership: { type: 'external' as const },
			configuration: { generation: 'test-generation-1' },
			identity: {
				privateKeyRef: 'secret://capacity/provider-identity',
				displayName: 'Test provider',
			},
			supplyCeilings: { maxConcurrentAssignments: 2 },
			executionProviders: [{
				id: 'codex-primary',
				adapter: 'codex',
				nativeLimits: { maxConcurrentRunners: 2 },
			}],
			connections: [{
				id: 'team-a',
				marketProfile: 'local',
				teamId: 'team-a',
				providerId: 'provider-a',
				membershipId: 'membership-a',
				membershipCredentialId: 'credential-a',
				membershipCredentialRef: 'secret://capacity/team-a',
				offer: { weight: 1, maxConcurrentRunners: 1, capabilities: ['engineering'] },
			}],
		};
		const initial = validateAndDigestCapacityProviderManifest(manifest).digest;
		const reordered = validateAndDigestCapacityProviderManifest({
			configuration: manifest.configuration,
			connections: manifest.connections,
			executionProviders: manifest.executionProviders,
			identity: manifest.identity,
			ownership: manifest.ownership,
			providerClass: manifest.providerClass,
			schemaVersion: manifest.schemaVersion,
			supplyCeilings: manifest.supplyCeilings,
		}).digest;
		const changed = validateAndDigestCapacityProviderManifest({
			...manifest,
			connections: [{ ...manifest.connections[0], offer: { ...manifest.connections[0]!.offer, weight: 2 } }],
		}).digest;
		expect(reordered).toBe(initial);
		expect(changed).not.toBe(initial);
		expect(localComposeReconciledSpecHash({ manifestDigest: initial }))
			.not.toBe(localComposeReconciledSpecHash({ manifestDigest: changed }));
	});
});
