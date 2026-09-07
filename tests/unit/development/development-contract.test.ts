import { describe, expect, it } from 'vitest';
import { developmentCandidateSchema, developmentRuntimeSchema, developmentSessionSchema, releaseEvidenceSchema } from '../../../src/development/index.ts';

const runtime = {
	schemaVersion: 'treeseed.development-runtime/v1',
	project: { id: 'admin', repository: 'treeseed-ai/admin' },
	defaults: { leaseSeconds: 3_600, restoreOnFailure: true },
	targets: [{
		id: 'web', kind: 'live-web', platforms: ['linux-amd64'], runtimeRequirements: ['node>=22'],
		sourceRoots: ['src'], ignoredPaths: ['dist'],
		operations: { start: { command: 'npm', args: ['run', 'dev'], environment: {}, timeoutSeconds: 600 } },
		ready: { kind: 'http', path: '/healthz', expectedStatus: 200, timeoutSeconds: 30 },
		outputs: [], endpoints: [{ id: 'http', protocol: 'http', port: 4322, canonicalAlias: 'admin.treeseed.localhost', visibility: 'host', authentication: 'application' }],
		dependencies: [{ id: 'api', target: 'service', capability: 'control-plane-api', locality: 'either', reaction: 'none' }],
		statePolicy: 'stateless', migrationPolicy: 'none', secretRefs: {},
		shutdown: { graceSeconds: 30, activeWorkPolicy: 'block' }, resources: {}, logs: [], forbiddenOperations: ['manager-socket'],
		promotion: { liveAdmissible: false, candidateRequiresVerification: true },
	}],
} as const;

describe('development runtime contracts', () => {
	it('normalizes old recipes once and rejects expiry settings in v2', () => {
		const current = developmentRuntimeSchema.parse(runtime);
		expect(current.schemaVersion).toBe('treeseed.development-runtime/v2');
		expect(current.defaults).toEqual({ restoreOnFailure: true });
		expect(developmentRuntimeSchema.parse(current)).toEqual(current);
		expect(() => developmentRuntimeSchema.parse({ ...current, defaults: { ...current.defaults, leaseSeconds: 600 } })).toThrow();
	});
	it('preserves old active session identity without expiry and never revives expired sessions', () => {
		const old = { schemaVersion: 'treeseed.development-session/v1', sessionId: 'session-1', actor: 'developer', hostId: 'host-1',
			createdAt: '2020-01-01T00:00:00.000Z', expiresAt: '2020-01-02T00:00:00.000Z', status: 'active', repositories: [], targets: [],
			leases: [{ kind: 'alias', resource: 'admin.treeseed.localhost', acquiredAt: '2020-01-01T00:00:00.000Z', expiresAt: '2020-01-02T00:00:00.000Z' }], restoredReceiptId: null, blockers: [] };
		const current = developmentSessionSchema.parse(old);
		expect(current).toMatchObject({ sessionId: 'session-1', status: 'active', schemaVersion: 'treeseed.development-session/v2' });
		expect(JSON.stringify(current)).not.toContain('expiresAt');
		expect(developmentSessionSchema.parse(current)).toEqual(current);
		expect(developmentSessionSchema.parse({ ...old, status: 'expired' }).status).toBe('stopped');
		expect(() => developmentSessionSchema.parse({ ...current, expiresAt: old.expiresAt })).toThrow();
	});
	it('accepts a project-owned live web target', () => {
		expect(developmentRuntimeSchema.parse(runtime).targets[0]?.id).toBe('web');
	});

	it.each(['/src', '../src', 'src/../secret', 'src\\secret'])('rejects unsafe source path %s', (sourceRoot) => {
		expect(() => developmentRuntimeSchema.parse({ ...runtime, targets: [{ ...runtime.targets[0], sourceRoots: [sourceRoot] }] })).toThrow(/path/i);
	});

	it('requires host-visible endpoints to use a canonical localhost alias', () => {
		const endpoint = { ...runtime.targets[0].endpoints[0] };
		delete (endpoint as { canonicalAlias?: string }).canonicalAlias;
		expect(() => developmentRuntimeSchema.parse({ ...runtime, targets: [{ ...runtime.targets[0], endpoints: [endpoint] }] })).toThrow(/canonical/i);
	});

	it('prevents companions from acquiring public routes', () => {
		expect(() => developmentRuntimeSchema.parse({ ...runtime, targets: [{ ...runtime.targets[0], kind: 'local-companion', endpoints: runtime.targets[0].endpoints }] })).toThrow(/loopback/i);
	});

	it('prevents dirty candidate source from becoming promotable', () => {
		const digest = `sha256:${'a'.repeat(64)}`;
		expect(() => developmentCandidateSchema.parse({
			schemaVersion: 'treeseed.development-candidate/v1', candidateId: 'candidate-1', sessionId: 'session-1', createdAt: new Date().toISOString(),
			source: [{ projectId: 'admin', repository: 'treeseed-ai/admin', worktree: '/tmp/admin', commit: 'a'.repeat(40), branch: 'staging', dirty: true, dirtyDigest: digest, recipeDigest: digest }],
			artifacts: [{ projectId: 'admin', targetId: 'web', kind: 'oci-image', identity: 'treeseed/admin:candidate', digest }],
			configurationDigest: digest, dependencyGenerations: {}, compatibilityAttestations: [],
			verification: { status: 'passed', operations: ['npm test'], completedAt: new Date().toISOString() }, promotable: true,
		})).toThrow(/dirty/i);
	});

	it('requires promotable candidates to bind every source generation', () => {
		const digest = `sha256:${'a'.repeat(64)}`;
		expect(() => developmentCandidateSchema.parse({
			schemaVersion: 'treeseed.development-candidate/v1', candidateId: 'candidate-1', sessionId: 'session-1', createdAt: new Date().toISOString(),
			source: [{ projectId: 'admin', repository: 'treeseed-ai/admin', worktree: '/tmp/admin', commit: 'a'.repeat(40), branch: 'staging', dirty: false, dirtyDigest: null, recipeDigest: digest }],
			artifacts: [{ projectId: 'admin', targetId: 'web', kind: 'oci-image', identity: 'treeseed/admin:candidate', digest }],
			configurationDigest: digest, dependencyGenerations: {}, compatibilityAttestations: [],
			verification: { status: 'passed', operations: ['npm test'], completedAt: new Date().toISOString() }, promotable: true,
		})).toThrow(/generation/i);
	});

	it('binds release contract evidence to artifacts in immutable custody', () => {
		const digest = `sha256:${'b'.repeat(64)}`;
		const evidence = releaseEvidenceSchema.parse({
			schemaVersion: 'treeseed.release-evidence/v1',
			candidate: { id: 'candidate-1', receiptDigest: digest, sourceCommit: 'a'.repeat(40), stagingRef: 'refs/heads/staging', workflowRunId: '123', createdAt: new Date().toISOString() },
			packages: [{ projectId: 'sdk', name: '@treeseed/sdk', version: '0.13.0-rc.46', minimumBump: 'patch' }],
			artifacts: [{ id: 'contracts', kind: 'contract-bundle', identity: 'contract-bundle.json', digest, mediaType: 'application/json' }],
			contractBundles: [{ id: 'sdk-contracts', digest }], compatibilityAttestations: [],
			verification: { status: 'passed', operations: ['npm test'], completedAt: new Date().toISOString() },
		});
		expect(evidence.artifacts[0]?.digest).toBe(digest);
	});
});
