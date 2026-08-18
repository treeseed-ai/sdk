import { describe, expect, it } from 'vitest';
import { readTestSource, resolveTestRoot } from '../../support/workspace-test-root.ts';

const testRoot = resolveTestRoot(import.meta.url);

function source(path: string) {
	const result = readTestSource(testRoot, path);
	expect(result, `${path} exists`).not.toBeNull();
	return result ?? '';
}

describe('switch/dev/save hard-cut boundaries', () => {
	it('keeps switch/save preview orchestration on branch-preview reconciliation', () => {
		const operations = source('packages/sdk/src/workflow/operations.ts');
		expect(operations).not.toMatch(/workflowPreviewDeployGateRequired|destroyPreviewIfPresent|deployBranchPreview/u);
		expect(operations).toMatch(/reconcileWorkflowBranchPreview/u);
		expect(operations).toMatch(/destroyWorkflowBranchPreviewIfPresent/u);
		expect(operations).toMatch(/resourceKind:\s*\['branch-preview/u);
	});

	it('keeps dev CLI as a local-process reconcile facade', () => {
		const dev = readTestSource(testRoot, 'packages/cli/src/cli/handlers/dev.ts');
		if (!dev) return;
		expect(dev).toMatch(/resourceKind:\s*\['local-process'\]/u);
		expect(dev).toMatch(/reconcileTarget/u);
		expect(dev).toMatch(/destroyTargetUnits/u);
		expect(dev).not.toMatch(/spawn|spawnSync|dev-platform|@treeseed\/core/u);
		expect(dev).toMatch(/const planOnly = invocation\.args\.plan === true/u);
	});

	it('keeps save reporting on desired resources instead of legacy hosting graph output', () => {
		const save = readTestSource(testRoot, 'packages/cli/src/cli/handlers/save.ts');
		if (!save) return;
		expect(save).toMatch(/compileDesiredResourceGraph/u);
		expect(save).toMatch(/selectDesiredResources/u);
		expect(save).not.toMatch(/resolveWorkflowHostingGraph|hostingGraphSections/u);
	});

	it('requires save hosted phases to reconcile branch environments explicitly', () => {
		const operations = source('packages/sdk/src/workflow/operations.ts');
		expect(operations).toMatch(/function saveHostedEnvironmentForBranch/u);
		expect(operations).toMatch(/async function reconcileSaveHostedEnvironment/u);
		expect(operations).toMatch(/compileHostingGraph/u);
		expect(operations).toMatch(/reconcileTarget/u);
		expect(operations).toMatch(/collectReconcileStatus/u);
		expect(operations).toMatch(/collectLiveHostedServiceChecks/u);
		expect(operations).toMatch(/rootReportForWave && !hostedEnvironment/u);
		expect(operations).not.toMatch(/Hosted deploy workflow dispatch is reconciler-owned/u);
	});
});
