import { mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { describe,expect,it } from 'vitest';
import { assertIsolatedRepositoryStorage,repositoryStorageOverlap } from '../../../src/repositories/repository-custody.ts';
import { repositoryIdentityKey,resolveRepositoryIdentity } from '../../../src/repositories/repository-identity.ts';
import { dedupeManagedReposByRemote } from '../../../src/workflow/operations/coordination/staging-candidate-workflow-gates.ts';
import { localDevelopmentResources } from '../../../src/platform/desired-state/local-development-resources.ts';
import { ensureManagedRepositoryStorage } from '../../../src/reconcile/builtin-adapters/reconciliation/managed-repository-storage.ts';

describe('repository identity and custody', () => {
	it('normalizes GitHub SSH, HTTPS, git+ssh, case, and suffix aliases', () => {
		const aliases = [
			'git@github.com:TreeSeed-AI/TreeSeed-Fixtures.git',
			'https://github.com/treeseed-ai/treeseed-fixtures',
			'git+ssh://git@github.com/treeseed-ai/treeseed-fixtures.git',
		];
		const identities = aliases.map((remote) => resolveRepositoryIdentity(remote));
		expect(new Set(identities.map((identity) => identity.canonicalKey))).toEqual(new Set([
			'github.com/treeseed-ai/treeseed-fixtures',
		]));
		expect(identities[0]?.canonicalRemoteUrl).toBe('https://github.com/treeseed-ai/treeseed-fixtures.git');
	});

	it('resolves relative submodule remotes against the parent repository', () => {
		expect(repositoryIdentityKey('../treeseed-fixtures.git', 'git@github.com:treeseed-ai/market.git'))
			.toBe('github.com/treeseed-ai/treeseed-fixtures');
	});

	it('deduplicates checked-out workflow repositories expressed through SSH and HTTPS aliases', () => {
		const common = { id: 'fixture', name: 'fixture', kind: 'fixture' as const, relativeDir: '.fixtures/fixture', branchName: 'feature/test', dirty: false, detached: false, hasOriginRemote: true, templateManifest: null };
		const repos = dedupeManagedReposByRemote([
			{ ...common, dir: '/workspace/a', remoteUrl: 'git@github.com:treeseed-ai/treeseed-fixtures.git' },
			{ ...common, id: 'fixture-copy', dir: '/workspace/b', remoteUrl: 'https://github.com/TreeSeed-AI/TreeSeed-Fixtures' },
		]);
		expect(repos).toHaveLength(1);
	});

	it('accepts separate canonical local custody roots and rejects overlap', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-custody-'));
		try {
			const state = resolve(root, '.treeseed');
			const managedRoots = ['local-capacity-provider/data', 'local-treedx/data']
				.map((path, index) => ({ custody: ['capacity-provider', 'treedx'][index] as 'capacity-provider' | 'treedx', path: resolve(state, path) }));
			for (const managed of managedRoots) mkdirSync(managed.path, { recursive: true });
			expect(() => assertIsolatedRepositoryStorage({ developerRoot: root, managedRoots })).not.toThrow();
			expect(repositoryStorageOverlap(managedRoots[0]!.path, resolve(managedRoots[0]!.path, 'nested'))).toBe(true);
			expect(() => assertIsolatedRepositoryStorage({ developerRoot: root, managedRoots: [
				managedRoots[0]!,
				{ custody: 'treedx', path: resolve(managedRoots[0]!.path, 'nested') },
			] })).toThrow(/overlap/u);
			for (const managed of managedRoots) {
				ensureManagedRepositoryStorage(root, { ...managed, hostPath: managed.path, servicePath: managed.custody === 'treedx' ? '/var/lib/treedx' : '/data' });
				const marker = JSON.parse(readFileSync(resolve(managed.path, '.treeseed-managed-storage.json'), 'utf8'));
				expect(marker).toMatchObject({ schema: 'treeseed.repository-storage/v1', custody: managed.custody, warning: 'managed-storage-do-not-edit' });
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('declares isolated provider and TreeDX repository storage without an API runner checkout', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-storage-plan-'));
		try {
		mkdirSync(resolve(root, 'seeds'), { recursive: true });
		mkdirSync(resolve(root, 'config'), { recursive: true });
		writeFileSync(resolve(root, 'seeds/test.yaml'), [
			'runtime:',
			'  capacityProviders:',
			'    - key: provider-a',
			'      providerClass: agent',
			'      environments: [local]',
			'      manifest: config/provider.yaml',
			'',
		].join('\n'));
		writeFileSync(resolve(root, 'config/provider.yaml'), [
			'schemaVersion: 2',
			'providerClass: agent',
			'ownership: { type: external }',
			'configuration: { generation: test-generation-1 }',
			'identity:',
			'  privateKeyRef: secret://capacity/provider-identity',
			'  displayName: Test provider',
			'supplyCeilings: { maxConcurrentAssignments: 1 }',
			'executionProviders:',
			'  - id: codex',
			'    adapter: codex',
			'    nativeLimits: { maxConcurrentRunners: 1 }',
			'connections: []',
			'',
		].join('\n'));
		const resources = localDevelopmentResources(root, 'local', 'none', [], undefined, undefined, ['test']);
		const capacity = resources.find((resource) => resource.kind === 'local-docker-compose' && resource.serviceId === 'agent');
		const operations = resources.find((resource) => resource.id === 'local-process:operations-runner');
		const treeDx = resources.find((resource) => resource.id === 'local-docker-compose:treedx');
		expect(capacity?.spec.managedStorage).toMatchObject({ custody: 'capacity-provider', servicePath: '/data' });
		expect(operations).toBeUndefined();
		expect(treeDx?.spec.managedStorage).toMatchObject({ custody: 'treedx', servicePath: '/var/lib/treedx' });
		expect(JSON.stringify(capacity?.spec.env)).not.toContain('TREESEED_PROVIDER_WORKSPACE');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
