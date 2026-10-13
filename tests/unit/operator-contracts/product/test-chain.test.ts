import { expect, it } from 'vitest';
import { sdkPublishedRepository, type PublishedSourceAttempt } from '../../../acceptance/product/test-chain.ts';

const attempt: PublishedSourceAttempt = { id: 'attempt', teamId: 'team', projectId: 'sdk', attempt: 1, provider: { providerId: 'provider' },
	workspace: { mode: 'git', repository: 'treeseed-ai/sdk', baseCommit: 'a'.repeat(40), branch: 'simulation/tester', writablePaths: ['tests'] } };
const reference = { kind: 'git' as const, repository: 'treeseed-ai/sdk', commit: 'b'.repeat(40), branch: 'simulation/tester' };
const repository = `/var/lib/treeseed/agent/workspaces/simulations/${'c'.repeat(64)}.git`;
function fixture() {
	const entry = (metadata: Record<string, unknown>) => ({ name: 'sandbox-test.json', type: 'file', digest: 'd'.repeat(64), metadata });
	const journals = { jobs: { rootPresent: true, entries: [entry({ schemaVersion: 'treeseed.assignment-source-job/v1', leaseId: 'lease',
		owner: { assignmentId: attempt.id, providerId: 'provider', teamId: 'team', projectId: 'sdk', attempt: 1 } })] },
		results: { rootPresent: true, entries: [entry({ schemaVersion: 'treeseed.source-result/v1', sandboxId: 'sandbox-test', leaseId: 'lease',
			status: 'completed', teardownVerified: true, source: { controlPlaneId: 'control', teamId: 'team', projectId: 'sdk', repositoryId: 'repository',
				commit: 'a'.repeat(40), formatVersion: 1, profile: 'source-only' }, sourceReference: reference, simulationRepository: repository })] } };
	return { complete: true, errors: [] as string[], scope: { storageRoot: '/var/lib/treeseed/agent/workspaces' }, journals,
		confirmation: { journals: structuredClone(journals) } };
}
it.each(['branch', 'repository'] as const)('denies a self-consistent published Git %s outside the original assignment workspace', field => {
		const changed = { ...reference, [field]: field === 'branch' ? 'simulation/foreign' : 'treeseed-ai/foreign' };
		const observation = fixture(); observation.journals.results.entries[0]!.metadata.sourceReference = changed;
		observation.confirmation.journals = structuredClone(observation.journals);
		const retained = structuredClone(observation);
		expect(() => sdkPublishedRepository(observation, 'sandbox-test', attempt, changed)).toThrow();
		expect(observation).toEqual(retained);
	expect(sdkPublishedRepository(fixture(), 'sandbox-test', attempt, reference)).toBe(repository);
});
it('requires complete unchanged public owning source custody and denies every foreign or ambiguous locator before native Git', () => {
	const original = fixture(), before = structuredClone(original);
	expect(sdkPublishedRepository(original, 'sandbox-test', attempt, reference)).toBe(repository); expect(original).toEqual(before);
	const mutations: Array<(value: ReturnType<typeof fixture>) => void> = [
		value => { value.complete = false; }, value => { value.errors.push('unreadable'); },
		value => { value.scope.storageRoot = '/tmp/arbitrary'; }, value => { value.journals.results.rootPresent = false; },
		value => { value.journals.results.entries = []; }, value => { value.journals.results.entries.push(value.journals.results.entries[0]!); },
		value => { value.journals.results.entries[0]!.digest = 'invalid'; }, value => { value.journals.results.entries[0]!.type = 'symlink'; },
		...['assignmentId', 'providerId', 'teamId', 'projectId', 'attempt'].map(field => (value: ReturnType<typeof fixture>) => {
			const owner = value.journals.jobs.entries[0]!.metadata.owner as Record<string, unknown>; owner[field] = field === 'attempt' ? 2 : 'foreign';
		}),
		...['teamId', 'projectId', 'commit'].map(field => (value: ReturnType<typeof fixture>) => {
			const source = value.journals.results.entries[0]!.metadata.source as Record<string, unknown>; source[field] = field === 'commit' ? 'f'.repeat(40) : 'foreign';
		}),
		...['sandboxId', 'leaseId', 'status', 'schemaVersion'].map(field => (value: ReturnType<typeof fixture>) => { value.journals.results.entries[0]!.metadata[field] = 'foreign'; }),
		value => { value.journals.results.entries[0]!.metadata.teardownVerified = false; },
		value => { value.journals.results.entries[0]!.metadata.source = {}; },
		value => { value.journals.results.entries[0]!.metadata.sourceReference = { ...reference, commit: 'e'.repeat(40) }; },
		value => { value.journals.results.entries[0]!.metadata.simulationRepository = '/tmp/arbitrary.git'; },
		value => { value.journals.results.entries[0]!.metadata.simulationRepository = null; },
	];
	for (const mutate of mutations) {
		const denied = fixture(); mutate(denied); denied.confirmation.journals = structuredClone(denied.journals);
		const retained = structuredClone(denied); expect(() => sdkPublishedRepository(denied, 'sandbox-test', attempt, reference)).toThrow();
		expect(denied).toEqual(retained);
	}
	const changed = fixture(); changed.confirmation.journals.results.entries = [];
	expect(() => sdkPublishedRepository(changed, 'sandbox-test', attempt, reference)).toThrow();
	expect(() => sdkPublishedRepository(original, '../sandbox-test', attempt, reference)).toThrow();
	expect(sdkPublishedRepository(original, 'sandbox-test', attempt, reference)).toBe(repository);
});
