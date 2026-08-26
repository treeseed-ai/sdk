import { describe, expect, it } from 'vitest';
import { developmentCandidateSchema, developmentRuntimeSchema } from '../../../src/development/index.ts';

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
});
