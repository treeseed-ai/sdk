import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultCiWorkflows } from '../../../src/workflow/operations/packages/release-admin-message.ts';
import { validateStagingWorkflowContracts } from '../../../src/workflow/operations/recovery/fail-workflow-run.ts';
import { gateForSavedRootReport } from '../../../src/workflow/operations/repositories/gates-for-saved-repository-reports.ts';
import { hostedWorkflowsForSavedRepository } from '../../../src/workflow/operations/projects/projects-core/connect-market-project.ts';
import type { RepositorySaveReport } from '../../../src/operations/services/repositories/repository-save-orchestrator.ts';

function savedMarketReport(path = '/workspace/market'): RepositorySaveReport {
	return {
		name: '@treeseed/market',
		path,
		branch: 'staging',
		dirty: true,
		created: false,
		resumed: false,
		merged: false,
		verified: true,
		committed: true,
		pushed: true,
		deletedLocal: false,
		deletedRemote: false,
		tagName: null,
		commitSha: 'abc123',
		skippedReason: null,
		publishWait: null,
		version: null,
		dependencySpec: null,
		branchMode: 'persistent',
		verification: null,
		install: null,
		lockfileValidation: null,
		commitMessage: null,
		commitMessageProvider: null,
		commitMessageFallbackUsed: false,
		commitMessageError: null,
	};
}

describe('hosted verification policy', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('selects verification for Market CI on persistent branches', () => {
		expect(defaultCiWorkflows('root', 'staging')).toEqual(['verify.yml']);
		expect(defaultCiWorkflows('root', 'main')).toEqual(['verify.yml']);
		expect(defaultCiWorkflows('package', 'staging')).toEqual(['verify.yml']);
	});

	it('requires only the non-mutating root verification workflow for staging', () => {
		vi.stubEnv('TREESEED_STAGE_WAIT_MODE', '');
		const root = mkdtempSync(join(tmpdir(), 'treeseed-staging-workflow-contract-'));
		const workflowRoot = resolve(root, '.github', 'workflows');
		mkdirSync(workflowRoot, { recursive: true });
		writeFileSync(resolve(workflowRoot, 'verify.yml'), 'name: Verify\n', 'utf8');

		expect(() => validateStagingWorkflowContracts(root)).not.toThrow();
	});

	it('uses verification rather than a deployment gate for saved Market commits', () => {
		const gates = gateForSavedRootReport(savedMarketReport(), 'staging', 'staging');

		expect(gates).toEqual([expect.objectContaining({
			name: '@treeseed/market',
			workflow: 'verify.yml',
			branch: 'staging',
			headSha: 'abc123',
		})]);
		expect(gates[0]).not.toHaveProperty('deployment');
	});

	it('never treats a deploy workflow as a save verification gate', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-save-verification-policy-'));
		const workflowRoot = resolve(root, '.github', 'workflows');
		mkdirSync(workflowRoot, { recursive: true });
		writeFileSync(resolve(root, 'treeseed.site.yaml'), 'schemaVersion: 1\n', 'utf8');
		writeFileSync(resolve(workflowRoot, 'deploy.yml'), 'name: Deploy\n', 'utf8');
		writeFileSync(resolve(workflowRoot, 'verify.yml'), 'name: Verify\n', 'utf8');

		expect(hostedWorkflowsForSavedRepository(root, savedMarketReport(root))).toEqual(['verify.yml']);
	});
});
