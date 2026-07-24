import { describe, expect, it } from 'vitest';
import { readTestSource, resolveTestRoot } from '../../support/workspace-test-root.ts';

const testRoot = resolveTestRoot(import.meta.url);

function source(relativePath: string) {
	const result = readTestSource(testRoot, relativePath);
	expect(result, `${relativePath} exists`).not.toBeNull();
	return result ?? '';
}

function functionBody(fileSource: string, functionName: string) {
	const marker = `export async function ${functionName}(`;
	const start = fileSource.indexOf(marker);
	expect(start, `${functionName} exists`).toBeGreaterThanOrEqual(0);
	const nextExport = fileSource.indexOf('\nexport async function ', start + marker.length);
	const nextInternal = fileSource.indexOf('\nasync function ', start + marker.length);
	const nextCandidates = [nextExport, nextInternal].filter((candidate) => candidate >= 0);
	const next = nextCandidates.length > 0 ? Math.min(...nextCandidates) : -1;
	return fileSource.slice(start, next === -1 ? undefined : next);
}

describe('reconciliation hard-cut source boundaries', () => {
	it('keeps stage as exact-ref promotion with hosted gates and release behind reconciliation', () => {
		const operations = source('packages/sdk/src/workflow/operations.ts');
		const stageBody = functionBody(operations, 'workflowStage');
		expect(stageBody).toContain('mode: \'stage-promotion\'');
		expect(stageBody).toContain('mergeBranchDownIntoFeature');
		expect(stageBody).toContain('promoteCommitToBranchWithExpectedHead');
		expect(stageBody).toContain('waitForWorkflowGates');
		expect(stageBody).toContain('stagingCandidateWorkflowGates');
		expect(stageBody).toContain('legacyMutationPathDisabled');
		for (const blocked of [
			'runReleaseGateReconcileFacade',
			'staging-candidate.yml',
			'runWorkflowHostedResourceVerification',
			'destroyWorkflowBranchPreviewIfPresent',
			'squashMergeBranchIntoStaging',
		]) {
			expect(stageBody, `workflowStage must not use ${blocked}`).not.toContain(blocked);
		}

		const releaseBody = functionBody(operations, 'workflowRelease');
		expect(releaseBody).toContain('runReleaseGateReconcileFacade');
		expect(releaseBody.indexOf('release-gates')).toBeGreaterThanOrEqual(0);
		expect(releaseBody.indexOf('release-root')).toBeGreaterThan(releaseBody.indexOf('release-gates'));
		expect(releaseBody.indexOf('publish-wait')).toBeGreaterThan(releaseBody.indexOf('release-root'));
		expect(releaseBody.indexOf('release-back-merge')).toBeGreaterThan(releaseBody.indexOf('publish-wait'));
		expect(releaseBody).toContain('waitForWorkflowGates');
		expect(releaseBody).not.toContain('runReleaseProductionGuarantees');
		expect(releaseBody).toContain('ensureReleaseTag');
		expect(releaseBody).toContain('promoteCommitToProductionBranch');
		expect(operations).toContain("unit.unitType !== 'release-gate:npm-publish'");
		expect(operations).toContain("unit.unitType !== 'release-gate:image-publish'");
		expect(operations).toContain('appendReleaseImageRefGitHubVariableBindings');
		expect(operations).toContain('github-variable-binding:@treeseed/api:production:${variableName}');
		expect(operations).toContain('releaseImageRef: true');
		for (const blocked of [
			'runWorkflowHostedResourceVerification',
			'destroyWorkflowBranchPreviewIfPresent',
			'squashMergeBranchIntoStaging',
			'runReleaseCandidateForPlan',
		]) {
			expect(releaseBody, `workflowRelease must not use ${blocked}`).not.toContain(blocked);
		}
	});

});
