import { describe, expect, it } from 'vitest';
import { sdkGoldenSource, verifySdkGoldenProduct } from '../../acceptance/golden-product.ts';
const commit = 'a'.repeat(40);
const release = { createdAt: 'now', status: 'completed', assignmentAttempt: { workItemId: 'simulate-release', effectiveProfile: { activity: 'acting' } },
	lifecycleOutput: { sourceReference: { kind: 'git', repository: 'treeseed-ai/sdk', commit } },
	assignmentResult: { references: [{ kind: 'git', commit }], verification: ['npm run standards:build', 'npm run build', 'npm run release:verify', 'npm pack', 'npm run test:contracts', 'npm run standards:acceptance -- --archive treeseed-sdk-1.0.0.tgz']
		.map(command => ({ command, status: 'passed', exitCode: 0, outputDigest: `sha256:${'b'.repeat(64)}`, durationSeconds: 1 })) } };
const review = { ...release, assignmentAttempt: { ...release.assignmentAttempt, effectiveProfile: { activity: 'reviewing' } },
	lifecycleOutput: { activityCompletion: { reviewDisposition: 'approved' } } };
describe('SDK golden product gate (fixtures are not acceptance)', () => {
	it('uses the exact current campaign source and rejects missing moving or unrelated freeze authority', () => {
		expect(sdkGoldenSource({ sourceHeads: { sdk: commit }, proposal: { id: 'proposal' } }, ['proposal'])).toBe(commit);
		for (const source of ['', 'staging', undefined]) expect(() => sdkGoldenSource({ sourceHeads: { sdk: source }, proposal: { id: 'proposal' } }, ['proposal']))
			.toThrow('ACCEPTANCE_SDK_FREEZE');
		expect(() => sdkGoldenSource({ sourceHeads: { sdk: commit }, proposal: { id: 'other' } }, ['proposal'])).toThrow('ACCEPTANCE_SDK_FREEZE');
	});
	it('rejects narrative archive inspection without a measured standalone archive command', () => {
		const missing = structuredClone(release); missing.assignmentResult.verification.pop();
		expect(() => verifySdkGoldenProduct([missing, review], commit)).toThrow('ACCEPTANCE_SDK_RELEASE_GATE');
		const missingReview = structuredClone(review); missingReview.assignmentResult.verification.pop();
		expect(() => verifySdkGoldenProduct([release, missingReview], commit)).toThrow('ACCEPTANCE_SDK_ARCHIVE_REVIEW');
	});
	it('accepts measured passing command evidence and rejects a missing full release gate', () => {
		const pipeline = structuredClone(release);
		pipeline.assignmentResult.verification = pipeline.assignmentResult.verification.filter(item => item.command !== 'npm run standards:build');
		expect(() => verifySdkGoldenProduct([pipeline, review], commit)).not.toThrow();
		const missing = structuredClone(release); missing.assignmentResult.verification.splice(2, 1);
		expect(() => verifySdkGoldenProduct([missing], commit)).toThrow('ACCEPTANCE_SDK_RELEASE_GATE');
	});
	it('rejects failed commands fabricated candidate and moving source', () => {
		const failed = structuredClone(release); failed.assignmentResult.verification[2]!.exitCode = 1;
		expect(() => verifySdkGoldenProduct([failed], commit)).toThrow('ACCEPTANCE_SDK_RELEASE_GATE');
		const candidate = structuredClone(release); candidate.assignmentResult.references[0]!.commit = 'staging';
		expect(() => verifySdkGoldenProduct([candidate, review], commit)).toThrow('ACCEPTANCE_SDK_CANDIDATE');
		expect(() => verifySdkGoldenProduct([release, review, { status: 'completed', assignmentAttempt: { workItemId: 'tests-first', effectiveProfile: { activity: 'acting' }, contextRefs: [] } }], commit)).toThrow('ACCEPTANCE_SDK_SOURCE');
	});
});
