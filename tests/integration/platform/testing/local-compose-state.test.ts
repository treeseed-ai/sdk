import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	localComposeDriftReasons,
	localComposeReconciledSpecHash,
	localComposeRequiredPathWarnings,
	localComposeServiceReady,
	observeLocalComposeRequiredPaths,
	parseLocalComposeServices,
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
			{ Service: 'manager', State: 'running', Health: 'healthy' },
			{ Service: 'runner', State: 'exited', Health: '' },
		]));
		expect(localComposeServiceReady(array.find((entry) => entry.service === 'manager'))).toBe(true);
		expect(localComposeServiceReady(array.find((entry) => entry.service === 'runner'))).toBe(false);
		const lines = parseLocalComposeServices('{"Service":"manager","State":"running"}\n{"Service":"runner","State":"running","Health":"unhealthy"}');
		expect(localComposeServiceReady(lines[0])).toBe(true);
		expect(localComposeServiceReady(lines[1])).toBe(false);
	});

	it('waits through a bounded starting state until every declared service is healthy', async () => {
		const observations = [
			[{ service: 'postgres', state: 'running', health: 'starting' }],
			[{ service: 'postgres', state: 'running', health: 'healthy' }],
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
			identity: {
				privateKeyRef: 'secret://capacity/provider-identity',
				displayName: 'Test provider',
			},
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
			connections: manifest.connections,
			executionProviders: manifest.executionProviders,
			identity: manifest.identity,
			schemaVersion: manifest.schemaVersion,
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
