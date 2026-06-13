import { describe, expect, it } from 'vitest';
import { readTreeseedTestSource, resolveTreeseedTestRoot } from './workspace-test-root.ts';

const testRoot = resolveTreeseedTestRoot(import.meta.url);

function source(relativePath: string) {
	const result = readTreeseedTestSource(testRoot, relativePath);
	expect(result, `${relativePath} exists`).not.toBeNull();
	return result ?? '';
}

function functionBody(fileSource: string, functionName: string) {
	const marker = `export async function ${functionName}`;
	const start = fileSource.indexOf(marker);
	expect(start, `${functionName} exists`).toBeGreaterThanOrEqual(0);
	const next = fileSource.indexOf('\nexport async function ', start + marker.length);
	return fileSource.slice(start, next === -1 ? undefined : next);
}

describe('reconciliation hard-cut source boundaries', () => {
	it('keeps stage and release as release-gate facades', () => {
		const operations = source('packages/sdk/src/workflow/operations.ts');
		for (const name of ['workflowStage', 'workflowRelease']) {
			const body = functionBody(operations, name);
			expect(body).toContain('runReleaseGateReconcileFacade');
			expect(body).toContain('legacyMutationPathDisabled');
			for (const blocked of [
				'executeJournalStep',
				'waitForWorkflowGates',
				'runWorkflowHostedResourceVerification',
				'destroyPreviewIfPresent',
				'squashMergeBranchIntoStaging',
				'runReleaseCandidateForPlan',
			]) {
				expect(body, `${name} must not use ${blocked}`).not.toContain(blocked);
			}
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
