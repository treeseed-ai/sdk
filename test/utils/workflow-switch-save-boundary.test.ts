import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function source(path: string) {
	return readFileSync(resolve(root, path), 'utf8');
}

describe('switch/dev/save hard-cut boundaries', () => {
	it('keeps switch/save preview orchestration on branch-preview reconciliation', () => {
		const operations = source('packages/sdk/src/workflow/operations.ts');
		expect(operations).not.toMatch(/workflowPreviewDeployGateRequired|destroyPreviewIfPresent|deployBranchPreview/u);
		expect(operations).toMatch(/reconcileTreeseedBranchPreview/u);
		expect(operations).toMatch(/destroyTreeseedBranchPreview/u);
		expect(operations).toMatch(/resourceKind:\s*\['branch-preview/u);
	});

	it('keeps dev CLI as a local-process reconcile facade', () => {
		const dev = source('packages/cli/src/cli/handlers/dev.ts');
		expect(dev).toMatch(/resourceKind:\s*\['local-process'\]/u);
		expect(dev).toMatch(/reconcileTreeseedTarget/u);
		expect(dev).toMatch(/destroyTreeseedTargetUnits/u);
		expect(dev).not.toMatch(/spawn|spawnSync|dev-platform|@treeseed\/core/u);
		expect(dev).toMatch(/const planOnly = invocation\.args\.plan === true/u);
	});

	it('keeps save reporting on desired resources instead of legacy hosting graph output', () => {
		const save = source('packages/cli/src/cli/handlers/save.ts');
		expect(save).toMatch(/compileTreeseedDesiredResourceGraph/u);
		expect(save).toMatch(/selectTreeseedDesiredResources/u);
		expect(save).not.toMatch(/resolveWorkflowHostingGraph|hostingGraphSections/u);
	});
});
