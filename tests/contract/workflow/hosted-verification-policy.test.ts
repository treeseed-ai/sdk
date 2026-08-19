import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { parse as parseYaml } from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultCiWorkflows } from '../../../src/workflow/operations/packages/release-admin-message.ts';
import { validateStagingWorkflowContracts } from '../../../src/workflow/operations/recovery/fail-workflow-run.ts';
import { gateForSavedRootReport } from '../../../src/workflow/operations/repositories/gates-for-saved-repository-reports.ts';
import { hostedWorkflowsForSavedRepository } from '../../../src/workflow/operations/support/workflow-helpers.ts';
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

async function evaluatePullRequestContract(input: { body:string; baseSha:string; headSha:string; draft?:boolean }) {
	const workflow = parseYaml(readFileSync(resolve(process.cwd(),'.github/workflows/pull-request-contract.yml'),'utf8')) as any;
	const script = workflow.jobs.validate.steps[0].with.script as string;
	const failures:string[] = [];
	await runInNewContext(`(async () => { ${script} })()`,{
		context:{ payload:{ pull_request:{ body:input.body,draft:input.draft ?? true,base:{ sha:input.baseSha },head:{ sha:input.headSha } } } },
		core:{ setFailed:(message:string)=>failures.push(message) },
	});
	return failures;
}

function pullRequestBody(baseSha:string,headSha:string) {
	return `## Outcome\nReady.\n\n## Work authority\n\n- Work item / Issue: issue-1\n- Proposal / decision: decision-1\n- Assignment / checkpoint: assignment-1\n- Actor: agent-1\n- Human authority: human-1\n- Agent / capacity provider: agent-1 / provider-1\n- Exact base ref: staging at ${baseSha}\n- Exact head ref: feature at ${headSha}\n\n- [x] Agent-authored under human authority\n\n## Plan\nPlan.\n\n## Changes and commits\nCommit.\n\n## Verification\nVerified.\n\n## Risk and rollback\nRevert.\n\n## Completion summary\nComplete.\n\n## Submission checklist\nPending.\n`;
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

	it('binds the durable pull request record to the provider base and head commits', async () => {
		const baseSha = 'a'.repeat(40);
		const headSha = 'b'.repeat(40);
		expect(await evaluatePullRequestContract({ body:pullRequestBody(baseSha,headSha),baseSha,headSha })).toEqual([]);
		expect(await evaluatePullRequestContract({ body:pullRequestBody(baseSha,'c'.repeat(40)),baseSha,headSha })).toEqual([
			expect.stringContaining(`Exact head ref is stale: expected ${headSha}`),
		]);
		expect(await evaluatePullRequestContract({ body:pullRequestBody('c'.repeat(40),headSha),baseSha,headSha })).toEqual([
			expect.stringContaining(`Exact base ref is stale: expected ${baseSha}`),
		]);
	});
});
