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

describe('treeseed workflow lifecycle: branch-worktree', () => {
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

it('auto-saves dirty task branches during close and returns to staging', async () => {
		const { work } = createWorkflowRepo();
		writeFileSync(resolve(work, 'feature.txt'), 'demo\nupdated\n', 'utf8');
		const workflow = workflowFor(work);

		const result = await workflow.close({
			message: 'superseded by another task',
		});

		expect(result.ok).toBe(true);
		expect(result.payload.autoSaved).toBe(true);
		expect(result.payload.finalBranch).toBe('staging');
		expect(result.payload.finalState.branchName).toBe('staging');
		expect(git(work, ['tag', '--list', 'deprecated/*'])).toContain('deprecated/feature-demo-task/');
	}, 180000);

it('can adopt unrelated package staging history into an initial production branch', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-workflow-unrelated-release-'));
		const origin = resolve(root, 'origin.git');
		const work = resolve(root, 'work');
		mkdirSync(work, { recursive: true });
		git(root, ['init', '--bare', origin]);
		git(work, ['init', '-b', 'main']);
		git(work, ['config', 'user.name', 'Treeseed Test']);
		git(work, ['config', 'user.email', 'treeseed@example.com']);
		writeFileSync(resolve(work, 'LICENSE'), 'license\n', 'utf8');
		git(work, ['add', 'LICENSE']);
		git(work, ['commit', '-m', 'init: production placeholder']);
		git(work, ['remote', 'add', 'origin', origin]);
		git(work, ['push', '-u', 'origin', 'main']);
		git(work, ['checkout', '--orphan', 'staging']);
		git(work, ['rm', '-rf', '.']);
		writeFileSync(resolve(work, 'package.json'), '{"name":"@treeseed/api","version":"0.1.0"}\n', 'utf8');
		git(work, ['add', 'package.json']);
		git(work, ['commit', '-m', 'build: stage package']);
		git(work, ['push', '-u', 'origin', 'staging']);

		const result = mergeBranchIntoTarget(work, {
			sourceBranch: 'staging',
			targetBranch: 'main',
			message: 'release: staging -> main',
			allowUnrelatedHistories: true,
		});

		expect(result.targetBranch).toBe('main');
		expect(git(work, ['merge-base', 'main', 'staging'])).toBeTruthy();
		expect(git(work, ['rev-parse', 'origin/main'])).toBe(git(work, ['rev-parse', 'main']));
		expect(readFileSync(resolve(work, 'package.json'), 'utf8')).toContain('@treeseed/api');
	}, 15000);

it('closes matching package task branches and preserves deprecated tags', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		await workflow.switchTask({ branch: 'feature/demo-task' });

		const result = await workflow.close({
			message: 'obsolete workstream',
		});

		expect(result.payload.mode).toBe('recursive-workspace');
		expect(git(work, ['branch', '--show-current'])).toBe('staging');
		expect(git(resolve(work, 'packages', 'sdk'), ['branch', '--show-current'])).toBe('staging');
		expect(git(work, ['branch', '--list', 'feature/demo-task'])).toBe('');
		expect(git(resolve(work, 'packages', 'sdk'), ['branch', '--list', 'feature/demo-task'])).toBe('');
		expect(git(resolve(work, 'packages', 'sdk'), ['tag', '--list', 'deprecated/*'])).toContain('deprecated/feature-demo-task/');
	}, 180000);

it('creates managed worktrees for agent switch without moving the primary checkout', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = new WorkflowSdk({
			cwd: work,
			env: { ...process.env, CODEX_AGENT_ID: 'agent-1', GIT_ALLOW_PROTOCOL: 'file' },
			write: () => {},
		});

		const result = await workflow.switchTask({
			branch: 'feature/agent-worktree',
		});

		expect(String(result.payload.worktreePath)).toContain('.treeseed/worktrees/');
		expect(git(work, ['branch', '--show-current'])).toBe('feature/demo-task');
		expect(git(String(result.payload.worktreePath), ['branch', '--show-current'])).toBe('feature/agent-worktree');
		expect(existsSync(resolve(String(result.payload.worktreePath), 'node_modules/.bin/trsd'))).toBe(true);
		expect(existsSync(resolve(String(result.payload.worktreePath), 'node_modules/.bin/treeseed'))).toBe(true);
	}, 180000);

it('fails switch when a checked-out package repo is dirty', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-dirty";\n', 'utf8');
		const workflow = workflowFor(work);

		await expect(workflow.switchTask({ branch: 'feature/blocked-task' })).rejects.toThrow(
			'clean git worktree',
		);
	}, 180000);

it('leaves divergent detached package repos untouched with a clear blocker', () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const sdkRoot = resolve(work, 'packages', 'sdk');
		git(sdkRoot, ['checkout', '-b', 'release-temp']);
		writeFileSync(resolve(sdkRoot, 'temp.txt'), 'not a release branch\n', 'utf8');
		git(sdkRoot, ['add', 'temp.txt']);
		git(sdkRoot, ['commit', '-m', 'test: divergent detached head']);
		const tempHead = git(sdkRoot, ['rev-parse', 'HEAD']);
		git(sdkRoot, ['checkout', '--detach', tempHead]);

		const report = reattachDetachedHeadIfSafe(sdkRoot, ['staging', 'main']);

		expect(report.repaired).toBe(false);
		expect(report.repairable).toBe(false);
		expect(report.blocker).toContain('does not match staging or main');
		expect(git(sdkRoot, ['rev-parse', 'HEAD'])).toBe(tempHead);
		expect(git(sdkRoot, ['branch', '--show-current'])).toBe('');
	}, 15_000);

it('reattaches a clean detached package repo at staging head', () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const sdkRoot = resolve(work, 'packages', 'sdk');
		const stagingHead = git(sdkRoot, ['rev-parse', 'staging']);
		git(sdkRoot, ['checkout', '--detach', stagingHead]);

		const report = reattachDetachedHeadIfSafe(sdkRoot, ['staging', 'main']);

		expect(report.repaired).toBe(true);
		expect(report.targetBranch).toBe('staging');
		expect(git(sdkRoot, ['branch', '--show-current'])).toBe('staging');
	}, 15_000);

it('reattaches a dirty detached package repo at the same staging head without losing changes', () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const sdkRoot = resolve(work, 'packages', 'sdk');
		const stagingHead = git(sdkRoot, ['rev-parse', 'staging']);
		git(sdkRoot, ['checkout', '--detach', stagingHead]);
		writeFileSync(resolve(sdkRoot, 'dirty.txt'), 'preserve me\n', 'utf8');

		const report = reattachDetachedHeadIfSafe(sdkRoot, ['staging', 'main']);

		expect(report.repaired).toBe(true);
		expect(report.dirty).toBe(true);
		expect(git(sdkRoot, ['branch', '--show-current'])).toBe('staging');
		expect(readFileSync(resolve(sdkRoot, 'dirty.txt'), 'utf8')).toBe('preserve me\n');
		expect(git(sdkRoot, ['status', '--porcelain'])).toContain('dirty.txt');
	}, 15_000);

it('removes managed worktrees after agent close cleanup', async () => {
		const { work } = createWorkflowRepo();
		const env = { ...process.env, CODEX_AGENT_ID: 'agent-1' };
		const workflow = new WorkflowSdk({ cwd: work, env, write: () => {} });
		const switched = await workflow.switchTask({
			branch: 'feature/agent-close',
		});
		const worktreePath = String(switched.payload.worktreePath);
		const managedWorkflow = new WorkflowSdk({ cwd: worktreePath, env, write: () => {} });

		const closed = await managedWorkflow.close({
			message: 'close agent branch',
			deletePreview: false,
		});

		expect(closed.payload.worktreeCleanup.removed).toBe(true);
		expect(existsSync(worktreePath)).toBe(false);
		expect(git(work, ['branch', '--show-current'])).toBe('feature/demo-task');
	}, 180000);

it('returns switch plans without mutating the market or package repos', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);

		const result = await workflow.switchTask({
			branch: 'feature/plan-only',
			plan: true,
		});

		expect(result.executionMode).toBe('plan');
		expect(result.payload.mode).toBe('recursive-workspace');
		expect(git(work, ['branch', '--show-current'])).toBe('feature/demo-task');
		expect(git(resolve(work, 'packages', 'sdk'), ['branch', '--show-current'])).toBe('staging');
		expect(git(work, ['ls-remote', '--heads', 'origin', 'feature/plan-only'])).toBe('');
		expect(git(resolve(work, 'packages', 'sdk'), ['ls-remote', '--heads', 'origin', 'feature/plan-only'])).toBe('');
	}, 180000);

it('save repairs package repos detached at the current branch head before preflight validation', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		git(work, ['checkout', 'staging']);
		const sdkRoot = resolve(work, 'packages', 'sdk');
		const stagingHead = git(sdkRoot, ['rev-parse', 'staging']);
		git(sdkRoot, ['checkout', '--detach', stagingHead]);
		const progress: string[] = [];
		const workflow = new WorkflowSdk({ cwd: work, write: (line) => progress.push(line) });

		const result = await workflow.save({
			message: 'chore: checkpoint after failed release',
			verify: false,
			refreshPreview: false,
		});

		expect(result.ok).toBe(true);
		expect(git(sdkRoot, ['branch', '--show-current'])).toBe('staging');
		expect(progress.join('\n')).toContain('[workflow][repair] Reattached @treeseed/sdk to staging');
	}, 360000);

it('stages from a managed worktree after local promotion proof', async () => {
		const { work } = createWorkflowRepo();
		git(work, ['checkout', 'staging']);
		const env = { ...process.env, CODEX_AGENT_ID: 'agent-1' };
		const workflow = new WorkflowSdk({ cwd: work, env, write: () => {} });
		const switched = await workflow.switchTask({
			branch: 'feature/agent-stage',
		});
		const worktreePath = String(switched.payload.worktreePath);
		writeFileSync(resolve(worktreePath, 'agent-stage.txt'), 'managed stage\n', 'utf8');
		const managedWorkflow = new WorkflowSdk({ cwd: worktreePath, env, write: () => {} });
		await managedWorkflow.save({
			message: 'save managed stage',
			verify: false,
			refreshPreview: false,
		});

			const staged = await managedWorkflow.stage({
				message: 'stage managed worktree',
				verifyMode: 'none',
				async: true,
				cleanupMode: 'success',
			});

		expect(staged.payload.mode).toBe('stage-promotion');
		expect(staged.payload.mergeStrategy).toBe('merge-staging-down-then-exact-sha');
		expect(staged.payload.worktreePath).toBe(worktreePath);
		expect(existsSync(worktreePath)).toBe(false);
		expect(git(work, ['branch', '--show-current'])).toBe('staging');
	}, 180000);

it('switch mirrors task branches into checked-out package repos without pushing package branches', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);

		const result = await workflow.switchTask({
			branch: 'feature/parallel-task',
		});

		expect(result.payload.mode).toBe('recursive-workspace');
		expect(git(work, ['branch', '--show-current'])).toBe('feature/parallel-task');
		expect(git(resolve(work, 'packages', 'sdk'), ['branch', '--show-current'])).toBe('feature/parallel-task');
		expect(git(resolve(work, 'packages', 'core'), ['branch', '--show-current'])).toBe('feature/parallel-task');
		expect(git(work, ['ls-remote', '--heads', 'origin', 'feature/parallel-task'])).toContain('feature/parallel-task');
		expect(git(resolve(work, 'packages', 'sdk'), ['ls-remote', '--heads', 'origin', 'feature/parallel-task'])).toBe('');
		expect(git(resolve(work, 'packages', 'core'), ['ls-remote', '--heads', 'origin', 'feature/parallel-task'])).toBe('');
	}, 180000);

it('treats normal package branch checkouts as a no-op', () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const sdkRoot = resolve(work, 'packages', 'sdk');

		const report = inspectDetachedHeadRepair(sdkRoot, ['staging', 'main']);

		expect(report.detached).toBe(false);
		expect(report.repairable).toBe(false);
		expect(git(sdkRoot, ['branch', '--show-current'])).toBe('staging');
	}, 15000);
});
