import { describe, expect, it } from 'vitest';
import { verifySdkGoldenProduct } from '../../acceptance/golden-product.ts';
const commit = 'a'.repeat(40);
const release = { createdAt: 'now', status: 'completed', assignmentAttempt: { workItemId: 'simulate-release', effectiveProfile: { activity: 'acting' } },
	lifecycleOutput: { sourceReference: { kind: 'git', repository: 'treeseed-ai/sdk', commit } },
	assignmentResult: { references: [{ kind: 'git', commit }], verification: ['npm run standards:build', 'npm run build', 'npm run release:verify', 'npm pack', 'workday-intent-portable.test.ts']
		.map(command => ({ command, status: 'passed', exitCode: 0, outputDigest: `sha256:${'b'.repeat(64)}`, durationSeconds: 1 })) } };
describe('SDK golden product gate (fixtures are not acceptance)', () => {
	it('accepts measured passing command evidence and rejects a missing full release gate', () => {
		expect(() => verifySdkGoldenProduct([release], commit)).not.toThrow();
		const missing = structuredClone(release); missing.assignmentResult.verification.splice(2, 1);
		expect(() => verifySdkGoldenProduct([missing], commit)).toThrow('ACCEPTANCE_SDK_RELEASE_GATE');
	});
	it('rejects failed commands fabricated candidate and moving source', () => {
		const failed = structuredClone(release); failed.assignmentResult.verification[2]!.exitCode = 1;
		expect(() => verifySdkGoldenProduct([failed], commit)).toThrow('ACCEPTANCE_SDK_RELEASE_GATE');
		const candidate = structuredClone(release); candidate.assignmentResult.references[0]!.commit = 'staging';
		expect(() => verifySdkGoldenProduct([candidate], commit)).toThrow('ACCEPTANCE_SDK_CANDIDATE');
		expect(() => verifySdkGoldenProduct([release, { status: 'completed', assignmentAttempt: { workItemId: 'tests-first', effectiveProfile: { activity: 'acting' }, contextRefs: [] } }], commit)).toThrow('ACCEPTANCE_SDK_SOURCE');
	});
});
