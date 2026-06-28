import { describe, expect, it } from 'vitest';
import { readTreeseedTestSource, resolveTreeseedTestRoot } from './workspace-test-root.ts';

const testRoot = resolveTreeseedTestRoot(import.meta.url);

function source(relativePath: string) {
	const result = readTreeseedTestSource(testRoot, relativePath);
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
	it('keeps stage as local ref promotion and release behind the release-gate reconciliation facade', () => {
		const operations = source('packages/sdk/src/workflow/operations.ts');
		const stageBody = functionBody(operations, 'workflowStage');
		expect(stageBody).toContain('mode: \'stage-promotion\'');
		expect(stageBody).toContain('mergeBranchDownIntoFeature');
		expect(stageBody).toContain('promoteCommitToBranchWithExpectedHead');
		expect(stageBody).toContain('legacyMutationPathDisabled');
		for (const blocked of [
			'runReleaseGateReconcileFacade',
			'waitForWorkflowGates',
			'runWorkflowHostedResourceVerification',
			'destroyWorkflowBranchPreviewIfPresent',
			'squashMergeBranchIntoStaging',
		]) {
			expect(stageBody, `workflowStage must not use ${blocked}`).not.toContain(blocked);
		}

		const releaseBody = functionBody(operations, 'workflowRelease');
		expect(releaseBody).toContain('runReleaseGateReconcileFacade');
		expect(releaseBody).toContain('legacyMutationPathDisabled');
		for (const blocked of [
			'executeJournalStep',
			'waitForWorkflowGates',
			'runWorkflowHostedResourceVerification',
			'destroyWorkflowBranchPreviewIfPresent',
			'squashMergeBranchIntoStaging',
			'runReleaseCandidateForPlan',
		]) {
			expect(releaseBody, `workflowRelease must not use ${blocked}`).not.toContain(blocked);
		}
	});

	it('keeps hosting apply backed by reconciliation only', () => {
		const graph = source('packages/sdk/src/hosting/graph.ts');
		const body = functionBody(graph, 'applyTreeseedHostingGraph');
		expect(body).toContain('reconcileTreeseedTarget');
		for (const blocked of [
			'.host.apply',
			'.host.verify',
			'deploySelectedRailwayServices',
			'reconcilePublicTreeDxUnits',
		]) {
			expect(body, `applyTreeseedHostingGraph must not use ${blocked}`).not.toContain(blocked);
		}
	});
});
