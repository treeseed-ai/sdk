import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sdkGoldenSource, verifySdkGoldenProduct } from '../../acceptance/golden-product.ts';
const commit = 'a'.repeat(40);
const release = { id: 'release-row', createdAt: 'now', status: 'completed', assignmentAttempt: { id: 'release-attempt', workdayId: 'workday-fixture', projectId: 'sdk-project', agentClass: 'renamed-releaser', workItemId: 'simulate-release', effectiveProfile: { activity: 'acting' } },
	lifecycleOutput: { sourceReference: { kind: 'git', repository: 'treeseed-ai/sdk', commit } },
	assignmentResult: { id: 'release-result', assignmentId: 'release-attempt', references: [{ kind: 'git', repository: 'treeseed-ai/sdk', commit }], verification: ['npm run standards:build', 'npm run build', 'npm run release:verify', 'npm pack', 'npm run test:contracts', 'npm run standards:acceptance -- --archive treeseed-sdk-1.0.0.tgz']
		.map(command => ({ command, status: 'passed', exitCode: 0, outputDigest: `sha256:${'b'.repeat(64)}`, durationSeconds: 1 })) } };
const review = { ...release, id: 'review-row', assignmentAttempt: { ...release.assignmentAttempt, id: 'review-attempt', agentClass: 'renamed-reviewer', effectiveProfile: { activity: 'reviewing' },
	contextRefs: [{ store: 'git', model: 'GitCommit', id: 'release-candidate', repository: 'treeseed-ai/sdk', commit }], predecessorResultIds: ['release-result'] },
	assignmentResult: { ...release.assignmentResult, id: 'review-result', assignmentId: 'review-attempt' },
	lifecycleOutput: { activityCompletion: { reviewDisposition: 'approved' } } };
describe('SDK golden product gate (fixtures are not acceptance)', () => {
	it('requires independent measured replay of all three public release commands and rejects every invalid reviewer receipt', () => {
		const before = structuredClone([release, review]);
		expect(() => verifySdkGoldenProduct([release, review], commit)).not.toThrow();
		for (const command of ['npm run release:verify', 'npm pack', 'npm run standards:acceptance -- --archive treeseed-sdk-1.0.0.tgz']) {
			const missing = structuredClone(review);
			missing.assignmentResult.verification = missing.assignmentResult.verification.filter(item => item.command !== command);
			expect(() => verifySdkGoldenProduct([release, missing], commit)).toThrow('ACCEPTANCE_SDK_ARCHIVE_REVIEW');
			for (const patch of [{ command: `echo ${command}` }, { command: `${command} && true` }, { status: 'failed' }, { status: 'skipped' },
				{ exitCode: 1 }, { exitCode: '0' }, { outputDigest: '' }, { outputDigest: `sha256:${'G'.repeat(64)}` },
				{ durationSeconds: undefined }, { durationSeconds: null }, { durationSeconds: '1' }, { durationSeconds: -1 }, { durationSeconds: 1.5 },
				{ durationSeconds: Number.NaN }, { durationSeconds: Number.POSITIVE_INFINITY }, { durationSeconds: Number.NEGATIVE_INFINITY }]) {
				const invalid = structuredClone(review);
				Object.assign(invalid.assignmentResult.verification.find(item => item.command === command)!, patch);
				const invalidBefore = structuredClone(invalid);
				expect(() => verifySdkGoldenProduct([release, invalid], commit)).toThrow('ACCEPTANCE_SDK_ARCHIVE_REVIEW');
				expect(invalid).toEqual(invalidBefore);
			}
		}
		expect([release, review]).toEqual(before);
	});
	it('binds independent release review to the exact actor result candidate repository and predecessor without rewriting history', () => {
		const before = structuredClone([release, review]);
		expect(() => verifySdkGoldenProduct([release, review], commit)).not.toThrow();
		for (const patch of [{ contextRefs: [] }, { contextRefs: [{ ...review.assignmentAttempt.contextRefs[0]!, commit: 'c'.repeat(40) }] },
			{ contextRefs: [{ ...review.assignmentAttempt.contextRefs[0]!, repository: 'other/sdk' }] },
			{ predecessorResultIds: [] }, { predecessorResultIds: ['foreign-result'] }, { predecessorResultIds: ['release-result', 'release-result'] },
			{ id: release.assignmentAttempt.id }, { workdayId: 'workday-foreign' }, { projectId: 'foreign-project' }, { agentClass: release.assignmentAttempt.agentClass }]) {
			const invalid = structuredClone(review); Object.assign(invalid.assignmentAttempt, patch);
			const invalidBefore = structuredClone(invalid);
			expect(() => verifySdkGoldenProduct([release, invalid], commit)).toThrow('ACCEPTANCE_SDK_ARCHIVE_REVIEW');
			expect(invalid).toEqual(invalidBefore);
		}
		for (const repository of ['other/sdk', '', undefined]) {
			const invalid = structuredClone(release); Object.assign(invalid.assignmentResult.references[0]!, { repository });
			const invalidBefore = structuredClone(invalid);
			expect(() => verifySdkGoldenProduct([invalid, review], commit)).toThrow('ACCEPTANCE_SDK_CANDIDATE');
			expect(invalid).toEqual(invalidBefore);
		}
		expect([release, review]).toEqual(before);
	});
	it('keeps standards generation and the full contract suite owned by release verification', () => {
		const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
		const verifier = readFileSync(new URL('../../../scripts/packages/release-verify.ts', import.meta.url), 'utf8');
		expect(manifest.scripts['release:verify']).toContain('./scripts/packages/release-verify.ts');
		expect(manifest.scripts.lint).toBe('npm run build:dist');
		expect(manifest.scripts.build).toBe('npm run build:dist');
		expect(manifest.scripts['test:release']).toBe('npm run test:contracts');
		expect(manifest.scripts['test:contracts']).toBe('vitest run --config ./vitest.contracts.config.ts');
		const build = verifier.indexOf("run('npm', ['run', 'lint']);");
		const generation = verifier.indexOf("run('npm', ['run', 'standards:build']);");
		const acceptance = verifier.indexOf("run('npm', ['run', 'standards:acceptance']);");
		const suite = verifier.indexOf("run('npm', ['run', 'test:release']);");
		expect(build).toBeGreaterThan(-1); expect(generation).toBeGreaterThan(build); expect(acceptance).toBeGreaterThan(generation); expect(suite).toBeGreaterThan(acceptance);
		expect(verifier).toContain('if (result.status !== 0)');
		expect(verifier).toContain('process.exit(result.status ?? 1)');
	});
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
		pipeline.assignmentResult.verification = pipeline.assignmentResult.verification.filter(item => !['npm run build', 'npm run standards:build', 'npm run test:contracts'].includes(item.command));
		expect(() => verifySdkGoldenProduct([pipeline, review], commit)).not.toThrow();
		const missing = structuredClone(release); missing.assignmentResult.verification.splice(2, 1);
		expect(() => verifySdkGoldenProduct([missing], commit)).toThrow('ACCEPTANCE_SDK_RELEASE_GATE');
		for (const command of ['echo npm run release:verify', 'npm run release:verify && true']) {
			const disguised = structuredClone(release); disguised.assignmentResult.verification[2]!.command = command;
			expect(() => verifySdkGoldenProduct([disguised, review], commit)).toThrow('ACCEPTANCE_SDK_RELEASE_GATE');
		}
	});
	it('accepts measured current-directory archives and rejects unsafe paths and invalid evidence', () => {
		for (const prefix of ['', './']) {
			const actor = structuredClone(release), reviewer = structuredClone(review);
			for (const item of [actor, reviewer]) item.assignmentResult.verification.at(-1)!.command = `npm run standards:acceptance -- --archive ${prefix}treeseed-sdk-1.0.0.tgz`;
			expect(() => verifySdkGoldenProduct([actor, reviewer], commit)).not.toThrow();
		}
		for (const path of ['../package.tgz', '/tmp/package.tgz', 'scratch/package.tgz', './scratch/package.tgz', './package.tgz && true']) {
			const actor = structuredClone(release); actor.assignmentResult.verification.at(-1)!.command = `npm run standards:acceptance -- --archive ${path}`;
			expect(() => verifySdkGoldenProduct([actor, review], commit)).toThrow('ACCEPTANCE_SDK_RELEASE_GATE');
			const reviewer = structuredClone(review); reviewer.assignmentResult.verification.at(-1)!.command = actor.assignmentResult.verification.at(-1)!.command;
			expect(() => verifySdkGoldenProduct([release, reviewer], commit)).toThrow('ACCEPTANCE_SDK_ARCHIVE_REVIEW');
		}
		for (const patch of [{ exitCode: 1 }, { status: 'failed' }, { outputDigest: '' }, { durationSeconds: -1 }]) {
			const actor = structuredClone(release); Object.assign(actor.assignmentResult.verification.at(-1)!, patch);
			expect(() => verifySdkGoldenProduct([actor, review], commit)).toThrow('ACCEPTANCE_SDK_RELEASE_GATE');
			const reviewer = structuredClone(review); Object.assign(reviewer.assignmentResult.verification.at(-1)!, patch);
			expect(() => verifySdkGoldenProduct([release, reviewer], commit)).toThrow('ACCEPTANCE_SDK_ARCHIVE_REVIEW');
		}
		const unapproved = structuredClone(review); unapproved.lifecycleOutput.activityCompletion.reviewDisposition = 'request_changes';
		expect(() => verifySdkGoldenProduct([release, unapproved], commit)).toThrow('ACCEPTANCE_SDK_ARCHIVE_REVIEW');
	});
	it('rejects failed commands fabricated candidate and moving source', () => {
		const failed = structuredClone(release); failed.assignmentResult.verification[2]!.exitCode = 1;
		expect(() => verifySdkGoldenProduct([failed], commit)).toThrow('ACCEPTANCE_SDK_RELEASE_GATE');
		const candidate = structuredClone(release); candidate.assignmentResult.references[0]!.commit = 'staging';
		expect(() => verifySdkGoldenProduct([candidate, review], commit)).toThrow('ACCEPTANCE_SDK_CANDIDATE');
		expect(() => verifySdkGoldenProduct([release, review, { status: 'completed', assignmentAttempt: { workItemId: 'tests-first', effectiveProfile: { activity: 'acting' }, contextRefs: [] } }], commit)).toThrow('ACCEPTANCE_SDK_SOURCE');
	});
});

it('ships golden acceptance using only the public assignment contract and declared package identity',()=>{
 const candidate=new URL('../../../',import.meta.url);
 const manifest=JSON.parse(readFileSync(new URL('package.json',candidate),'utf8'));
 const asset=readFileSync(new URL('tests/acceptance/golden-product.test.ts',candidate),'utf8');
 expect(manifest.files).toContain('treeseed.package.yaml');
 expect(asset).toContain("from '@treeseed/sdk/agent-capacity'");
 expect(asset).not.toMatch(/from ['"].*src\//u);
});
