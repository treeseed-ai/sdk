import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowSdk } from '../../../../src/operations/workflow.ts';
import {
	normalizeReleaseCandidateMode,
	normalizeSaveCiMode,
	normalizeSaveLane,
	shouldUseHostedSaveCi,
	WorkflowError,
} from '../../../../src/workflow/operations.ts';
import { resolveWorkflowPaths } from '../../../../src/workflow/policy.ts';
import { acquireWorkflowLock, createWorkflowRunJournal, releaseWorkflowLock, updateWorkflowRunJournal } from '../../../../src/workflow/runs.ts';
import { runWorkspaceSavePreflight } from '../../../../src/operations/services/hosting/deployment/save-deploy-preflight.ts';
import { inspectDetachedHeadRepair, mergeBranchIntoTarget, reattachDetachedHeadIfSafe } from '../../../../src/operations/services/operations/git-workflow.ts';
import {
	createDefaultMachineConfig,
	ensureSecretSessionForConfig,
	loadMachineConfig,
	lockSecretSession,
	setMachineEnvironmentValue,
	MACHINE_KEY_PASSPHRASE_ENV,
	writeMachineConfig,
} from '../../../../src/operations/services/configuration/config-runtime.ts';
vi.mock('../../../../src/operations/services/hosting/deployment/save-deploy-preflight.ts', async () => {
	const actual = await vi.importActual<typeof import('../../../../src/operations/services/hosting/deployment/save-deploy-preflight.ts')>('../../../../src/operations/services/hosting/deployment/save-deploy-preflight.ts');
	return {
		...actual,
		runWorkspaceReleasePreflight: vi.fn(),
		runWorkspaceSavePreflight: vi.fn(),
		runTenantDeployPreflight: vi.fn(),
	};
});
import { git, gitAllowFile, writePassingStageCandidate, writeTenantFiles, writeRootWorkspaceManifests, writeStatusConfigEntry, createMachineConfigForWorkflowRepo, writePackageFiles, createPackageRepo, addStaleNestedSubmodule, createWorkflowRepo, workflowFor, setPackageVersion } from './workflow-lifecycle.support.ts';

describe('treeseed workflow lifecycle: recovery', () => {
beforeEach(() => {
		vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'treeseed-workflow-home-')));
		vi.stubEnv('TREESEED_STAGE_WAIT_MODE', 'skip');
		vi.stubEnv('TREESEED_COMMIT_MESSAGE_PROVIDER', 'fallback');
		vi.stubEnv('TREESEED_SAVE_NPM_INSTALL_MODE', 'skip');
		vi.stubEnv('TREESEED_GIT_DEPENDENCY_SMOKE', 'skip');
		vi.stubEnv('TREESEED_COMMAND_READINESS_MODE', 'skip');
		vi.stubEnv('TREESEED_RELEASE_CANDIDATE_REHEARSAL_MODE', 'skip');
		vi.stubEnv('TREESEED_RELEASE_CANDIDATE_CONFIG_PARITY_MODE', 'skip');
		vi.stubEnv('TREESEED_WORKFLOW_RELEASE_GATES_MODE', 'skip');
		vi.stubEnv('TREESEED_WORKFLOW_HOSTED_RECONCILE_MODE', 'skip');
		vi.stubEnv('GIT_ALLOW_PROTOCOL', 'file:ssh:https:http:git');
	});

afterEach(() => {
		vi.unstubAllEnvs();
	});

it('adopts dirty staging work into a new recovery branch without rewriting files', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		git(work, ['checkout', 'staging']);
		for (const dirName of ['sdk', 'ui', 'core', 'admin', 'cli', 'agent', 'api', 'treedx']) {
			git(resolve(work, 'packages', dirName), ['checkout', 'staging']);
		}
		writeFileSync(resolve(work, 'recovery.txt'), 'root recovery\n');
		writeFileSync(resolve(work, 'packages', 'sdk', 'recovery.txt'), 'sdk recovery\n');

		const result = await workflowFor(work).switchTask({
			branch: 'recovery/save-stage-release',
			adoptChanges: true,
			worktreeMode: 'off',
		});

		expect(result.payload.preconditions).toMatchObject({ cleanWorktreeRequired: false, adoptedDirtyStagingChanges: true });
		expect(git(work, ['branch', '--show-current'])).toBe('recovery/save-stage-release');
		expect(git(resolve(work, 'packages', 'sdk'), ['branch', '--show-current'])).toBe('recovery/save-stage-release');
		expect(readFileSync(resolve(work, 'recovery.txt'), 'utf8')).toBe('root recovery\n');
		expect(readFileSync(resolve(work, 'packages', 'sdk', 'recovery.txt'), 'utf8')).toBe('sdk recovery\n');
	}, 360000);

it('does not auto-resume a failed save when the workspace has new edits', async () => {
		const { work, packages } = createWorkflowRepo({ withWorkspacePackages: true });
		git(work, ['checkout', 'staging']);
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-dirty-save";\n', 'utf8');
		git(resolve(work, 'packages', 'core'), ['remote', 'remove', 'origin']);
		const workflow = workflowFor(work);

		await expect(workflow.save({
			message: 'feat: original dirty save',
			verify: false,
			ciMode: 'off',
			refreshPreview: false,
		})).rejects.toBeInstanceOf(WorkflowError);

		const recoverResult = await workflow.recover();
		const runId = recoverResult.payload.interruptedRuns[0]?.runId;
		expect(runId).toMatch(/^save-/);

		git(resolve(work, 'packages', 'core'), ['remote', 'add', 'origin', packages!.core.origin]);
		writeFileSync(resolve(work, 'README.md'), '# Demo\n\nnew repair edits\n', 'utf8');

		const freshResult = await workflow.save({
			message: 'fix: save repair edits',
			verify: false,
			ciMode: 'off',
			refreshPreview: false,
		});
		expect(freshResult.runId).not.toBe(runId);
		expect(freshResult.payload.autoResumed).toBe(false);
		expect(freshResult.payload.message).toBe('fix: save repair edits');
	}, 360000);

it('lists interrupted workflow runs and resumes them after the workspace is repaired', async () => {
		const { work, packages } = createWorkflowRepo({ withWorkspacePackages: true });
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-updated";\n', 'utf8');
		writeFileSync(resolve(work, 'packages', 'core', 'index.js'), 'export const name = "core-updated";\n', 'utf8');
		git(resolve(work, 'packages', 'core'), ['remote', 'remove', 'origin']);
		const workflow = workflowFor(work);

		await expect(workflow.save({
			message: 'feat: recursive save',
			verify: false,
			refreshPreview: false,
		})).rejects.toBeInstanceOf(WorkflowError);

		const recoverResult = await workflow.recover();
		const runId = recoverResult.payload.interruptedRuns[0]?.runId;
		expect(recoverResult.payload.interruptedRuns.length).toBe(1);
		expect(runId).toMatch(/^save-/);

		git(resolve(work, 'packages', 'core'), ['remote', 'add', 'origin', packages!.core.origin]);

		const resumeResult = await workflow.resume({ runId });
		expect(resumeResult.runId).toBe(runId);
		expect(resumeResult.payload.repos.find((repo: { name: string }) => repo.name === '@treeseed/sdk')?.commitSha).toBeTruthy();
		expect(resumeResult.payload.repos.find((repo: { name: string }) => repo.name === '@treeseed/core')?.pushed).toBe(true);
		expect(resumeResult.payload.rootRepo.pushed).toBe(true);

		const finalRecover = await workflow.recover();
		expect(finalRecover.payload.interruptedRuns.length).toBe(0);
	}, 360000);

it('reports partial recursive save state when a later package repo cannot be pushed', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-updated";\n', 'utf8');
		writeFileSync(resolve(work, 'packages', 'core', 'index.js'), 'export const name = "core-updated";\n', 'utf8');
		git(resolve(work, 'packages', 'core'), ['remote', 'remove', 'origin']);
		const workflow = workflowFor(work);

		try {
			await workflow.save({
				message: 'feat: recursive save',
				verify: false,
				refreshPreview: false,
			});
		} catch (error) {
			expect(error).toBeInstanceOf(WorkflowError);
			const workflowError = error as WorkflowError;
			const details = (
				(workflowError.details?.partialFailure as {
					repos: Array<{ name: string; pushed: boolean }>;
					failingRepo: string;
				} | undefined)
				?? (workflowError.details?.details as {
					partialFailure?: {
						repos: Array<{ name: string; pushed: boolean }>;
						failingRepo: string;
					};
				} | undefined)?.partialFailure
			) as {
				repos: Array<{ name: string; pushed: boolean }>;
				failingRepo: string;
			};
			expect(details.failingRepo).toBe('@treeseed/core');
			expect(details.repos.find((repo) => repo.name === '@treeseed/sdk')?.pushed).toBe(false);
			expect(details.repos.find((repo) => repo.name === '@treeseed/core')?.pushed).toBe(false);
		}
	}, 360000);

it('requires explicit resume for the newest failed same-branch save', async () => {
		const { work, packages } = createWorkflowRepo({ withWorkspacePackages: true });
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-auto-resume";\n', 'utf8');
		writeFileSync(resolve(work, 'packages', 'core', 'index.js'), 'export const name = "core-auto-resume";\n', 'utf8');
		git(resolve(work, 'packages', 'core'), ['remote', 'remove', 'origin']);
		const workflow = workflowFor(work);

		await expect(workflow.save({
			message: 'feat: original save',
			verify: false,
			refreshPreview: false,
		})).rejects.toBeInstanceOf(WorkflowError);

		const recoverResult = await workflow.recover();
		const runId = recoverResult.payload.interruptedRuns[0]?.runId;
		expect(runId).toMatch(/^save-/);

		git(resolve(work, 'packages', 'core'), ['remote', 'add', 'origin', packages!.core.origin]);

		await expect(workflow.save({
			message: 'feat: new hint should not win',
			verify: false,
			refreshPreview: false,
		})).rejects.toThrow(new RegExp(`trsd resume ${runId}`, 'u'));

		const resumeResult = await workflow.resume({ runId });
		expect(resumeResult.runId).toBe(runId);
		expect(resumeResult.payload.message).toBe('feat: original save');
		expect(resumeResult.payload.repos.find((repo: { name: string }) => repo.name === '@treeseed/core')?.pushed).toBe(true);
		expect(resumeResult.payload.rootRepo.pushed).toBe(true);
	}, 360000);

it('surfaces active workflow locks through recover and blocks concurrent mutating commands', async () => {
		const { work } = createWorkflowRepo();
		const workflow = workflowFor(work);
		const lock = acquireWorkflowLock(work, 'save', 'save-lock-test');
		expect(lock.acquired).toBe(true);

		try {
			const recoverResult = await workflow.recover();
			expect(recoverResult.payload.lock.active).toBe(true);
			expect(recoverResult.payload.lock.lock?.runId).toBe('save-lock-test');
			await expect(workflow.switchTask({ branch: 'feature/blocked-lock' })).rejects.toMatchObject({
				code: 'workflow_locked',
			});
		} finally {
			releaseWorkflowLock(work, 'save-lock-test');
		}
	}, 360000);
});
