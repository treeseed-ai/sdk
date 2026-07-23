import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TreeseedWorkflowSdk } from '../../../src/workflow.ts';
import {
	normalizeReleaseCandidateMode,
	normalizeSaveCiMode,
	normalizeSaveLane,
	shouldUseHostedSaveCi,
	TreeseedWorkflowError,
} from '../../../src/workflow/operations.ts';
import { resolveTreeseedWorkflowPaths } from '../../../src/workflow/policy.ts';
import { acquireWorkflowLock, createWorkflowRunJournal, releaseWorkflowLock, updateWorkflowRunJournal } from '../../../src/workflow/runs.ts';
import { runWorkspaceSavePreflight } from '../../../src/operations/services/save-deploy-preflight.ts';
import { inspectDetachedHeadRepair, mergeBranchIntoTarget, reattachDetachedHeadIfSafe } from '../../../src/operations/services/git-workflow.ts';
import {
	createDefaultTreeseedMachineConfig,
	ensureTreeseedSecretSessionForConfig,
	loadTreeseedMachineConfig,
	lockTreeseedSecretSession,
	setTreeseedMachineEnvironmentValue,
	TREESEED_MACHINE_KEY_PASSPHRASE_ENV,
	writeTreeseedMachineConfig,
} from '../../../src/operations/services/config-runtime.ts';
vi.mock('../../../src/operations/services/save-deploy-preflight.ts', async () => {
	const actual = await vi.importActual<typeof import('../../../src/operations/services/save-deploy-preflight.ts')>('../../../src/operations/services/save-deploy-preflight.ts');
	return {
		...actual,
		runWorkspaceReleasePreflight: vi.fn(),
		runWorkspaceSavePreflight: vi.fn(),
		runTenantDeployPreflight: vi.fn(),
	};
});
import { git, gitAllowFile, writePassingStageCandidate, writeTenantFiles, writeRootWorkspaceManifests, writeStatusConfigEntry, createMachineConfigForWorkflowRepo, writePackageFiles, createPackageRepo, addStaleNestedSubmodule, createWorkflowRepo, workflowFor, setPackageVersion } from './workflow-lifecycle.support.ts';
import { readSourceModule } from '../../support/workspace-test-root.ts';

describe('treeseed workflow lifecycle: save-stage', () => {
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

it('defaults staging save plans to the fast lane', () => {
		const lane = normalizeSaveLane(undefined);

		expect(lane).toBe('fast');
		expect(normalizeSaveCiMode(undefined, 'staging', lane)).toBe('off');
		expect(normalizeReleaseCandidateMode(undefined, 'save', lane)).toBe('skip');
		expect(shouldUseHostedSaveCi({ plan: true, refreshPreview: false }, 'staging', lane)).toBe(false);
	});

it('loads existing machine config secrets before evaluating status readiness', async () => {
		const { work } = createWorkflowRepo();
		writeStatusConfigEntry(work);
		writeTreeseedMachineConfig(work, createMachineConfigForWorkflowRepo(work));
		const statusEnv = {
			...process.env,
			[TREESEED_MACHINE_KEY_PASSPHRASE_ENV]: 'status-passphrase',
		};
		await ensureTreeseedSecretSessionForConfig({
			tenantRoot: work,
			interactive: false,
			env: statusEnv,
			createIfMissing: true,
			allowMigration: true,
		});
		setTreeseedMachineEnvironmentValue(work, 'staging', {
			id: 'STATUS_REQUIRED_TOKEN',
			sensitivity: 'secret',
			storage: 'scoped',
		} as any, 'from-machine-config');
		setTreeseedMachineEnvironmentValue(work, 'staging', {
			id: 'TREESEED_RAILWAY_API_TOKEN',
			sensitivity: 'secret',
			storage: 'shared',
		} as any, 'railway-token-from-machine-config');
		lockTreeseedSecretSession(work);
		const workflow = new TreeseedWorkflowSdk({ cwd: work, env: statusEnv, write: () => {} });

		const result = await workflow.status();

		expect(result.ok).toBe(true);
		expect(result.payload.auth.railway).toBe(false);
		expect(result.payload.providerStatus.staging.railway.configured).toBe(false);
		expect(result.payload.providerStatus.local.railway.configured).toBe(true);
		expect(result.payload.providerStatus.local.railway.applicable).toBe(false);
		expect(result.payload.secrets.keyAgentUnlocked).toBe(true);
		expect(result.payload.persistentEnvironments.staging.blockers.join('\n')).not.toContain('STATUS_REQUIRED_TOKEN');
	}, 360000);

it('reconciles staging hosting when deployed resource verification has no pushed save', () => {
		const source = readSourceModule(new URL('../../../src/workflow/operations.ts', import.meta.url));
		const hostedCiStart = source.indexOf('async function reconcileSaveHostedEnvironment');
		const hostedCiEnd = source.indexOf('function recordHostedDeploymentStatesFromRootGates', hostedCiStart);
		const hostedCiSource = source.slice(hostedCiStart, hostedCiEnd);

		expect(hostedCiSource).toContain('compileTreeseedHostingGraph');
		expect(hostedCiSource).toContain('selectorFromWorkflowHostingGraph');
		expect(hostedCiSource).toContain('reconcileTreeseedTarget');
		expect(hostedCiSource).toContain('collectTreeseedReconcileStatus');
		expect(hostedCiSource).toContain('collectTreeseedLiveHostedServiceChecks');
		expect(hostedCiSource).toContain("status: 'reconciled'");
	});

it('recursively saves dirty checked-out workspace packages before saving the market repo', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-updated";\n', 'utf8');
		writeFileSync(resolve(work, 'packages', 'core', 'index.js'), 'export const name = "core-updated";\n', 'utf8');
		writeFileSync(resolve(work, 'feature.txt'), 'demo\nupdated\n', 'utf8');
		const workflow = workflowFor(work);

		const result = await workflow.save({
			message: 'feat: recursive save',
			verify: false,
			refreshPreview: false,
		});

		expect(result.ok).toBe(true);
		expect(result.payload.mode).toBe('recursive-workspace');
		expect(result.payload.repos.map((repo) => repo.name)).toEqual(expect.arrayContaining([
			'@treeseed/sdk',
			'@treeseed/ui',
			'@treeseed/core',
			'@treeseed/admin',
			'@treeseed/cli',
			'@treeseed/agent',
		]));
		expect(result.payload.repos[0].committed).toBe(true);
		expect(result.payload.repos[0].pushed).toBe(true);
		expect(result.payload.repos.find((repo) => repo.name === '@treeseed/core')?.committed).toBe(true);
		expect(result.payload.repos.find((repo) => repo.name === '@treeseed/admin')?.committed).toBe(true);
		expect(result.payload.repos.find((repo) => repo.name === '@treeseed/cli')?.committed).toBe(true);
		expect(result.payload.repos[0].tagName).toBeNull();
		expect(result.payload.repos.find((repo) => repo.name === '@treeseed/cli')?.tagName).toBeNull();
		expect(result.payload.rootRepo.committed).toBe(true);
		expect(git(resolve(work, 'packages', 'sdk'), ['branch', '--show-current'])).toBe('feature/demo-task');
		expect(git(resolve(work, 'packages', 'core'), ['branch', '--show-current'])).toBe('feature/demo-task');
		expect(git(work, ['ls-tree', 'HEAD', 'packages/sdk'])).toContain(result.payload.repos[0].commitSha);
		expect(git(work, ['ls-tree', 'HEAD', 'packages/core'])).toContain(result.payload.repos.find((repo) => repo.name === '@treeseed/core')?.commitSha);
		const sdkVersion = JSON.parse(readFileSync(resolve(work, 'packages', 'sdk', 'package.json'), 'utf8')).version;
		const coreSdkSpec = JSON.parse(readFileSync(resolve(work, 'packages', 'core', 'package.json'), 'utf8')).dependencies['@treeseed/sdk'];
		expect(sdkVersion).toMatch(/^0\.4\.13-dev\.feature-demo-task\./);
		expect(coreSdkSpec).toMatch(/^git\+file:\/\/.*sdk\.git#[a-f0-9]{40}$/u);
	}, 180000);

it('resolves status from nested directories against the tenant root', () => {
		const { work } = createWorkflowRepo();
		const nested = resolve(work, 'src', 'content');
		const result = resolveTreeseedWorkflowPaths(nested);

		expect(result.cwd).toBe(work);
		expect(result.branchName).toBe('feature/demo-task');
		expect(result.branchRole).toBe('feature');
	});

it('stages package feature branches through local ref promotion', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		await workflow.switchTask({ branch: 'feature/demo-task' });
		const fixtureRepo = addStaleNestedSubmodule(resolve(work, 'packages', 'sdk'), '.fixtures/treeseed-fixtures', 'feature/demo-task');
		git(fixtureRepo, ['pull', '--ff-only', 'origin', 'feature/demo-task']);
		git(resolve(work, 'packages', 'sdk'), ['add', '-A']);
		git(resolve(work, 'packages', 'sdk'), ['commit', '-m', 'test: add helper repos']);
		git(resolve(work, 'packages', 'sdk'), ['push', 'origin', 'feature/demo-task']);
		const templateRepo = addStaleNestedSubmodule(work, 'starters/research', 'feature/demo-task');
		git(templateRepo, ['pull', '--ff-only', 'origin', 'feature/demo-task']);
		git(work, ['add', 'packages/sdk']);
		git(work, ['add', '.gitmodules', 'starters/research']);
		git(work, ['commit', '-m', 'test: update sdk helper repos']);
		git(work, ['push', 'origin', 'feature/demo-task']);
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-staged";\n', 'utf8');
		writeFileSync(resolve(work, 'feature.txt'), 'demo\nstage\n', 'utf8');
			await workflow.save({
				message: 'feat: prepare stage',
				verify: false,
				refreshPreview: false,
			});
			createWorkflowRunJournal(work, {
				runId: 'stage-interrupted-without-preflight',
				command: 'stage',
				input: { message: 'stale interrupted stage' },
				session: {
					root: work,
					mode: 'recursive-workspace',
					branchName: 'feature/demo-task',
					repos: [
						{ name: '@treeseed/market', path: work, branchName: 'feature/demo-task' },
						{ name: '@treeseed/sdk', path: resolve(work, 'packages', 'sdk'), branchName: 'feature/demo-task' },
					],
				},
				steps: [
					{ id: 'verify-integrated-feature', description: 'Run local proof before staging mutation', repoName: '@treeseed/market', repoPath: work, branch: 'feature/demo-task', resumable: true },
				],
			});
			updateWorkflowRunJournal(work, 'stage-interrupted-without-preflight', (journal) => ({
				...journal,
				status: 'failed',
				failure: { code: 'verification_failed', message: 'stale interrupted proof', details: null, at: new Date().toISOString() },
			}));
			await workflow.recover({
				obsoleteRunId: 'stage-interrupted-without-preflight',
				obsoleteReason: 'superseded by explicit stage test',
			});
			vi.mocked(runWorkspaceSavePreflight).mockImplementationOnce(({ cwd }) => {
				expect(existsSync(resolve(cwd, 'node_modules', '@treeseed', 'core', 'package.json'))).toBe(true);
			});

		const result = await workflow.stage({
			message: 'stage: finish demo task',
			verifyMode: 'none',
			async: true,
			cleanupMode: 'manual',
		});

		expect(result.payload.mode).toBe('stage-promotion');
		const promotedRepoNames = result.payload.plan.repos.map((repo: { name: string }) => repo.name);
		expect(promotedRepoNames.some((name: string) => name.startsWith('fixture:'))).toBe(true);
		expect(promotedRepoNames.some((name: string) => name.startsWith('template:'))).toBe(true);
		expect(result.payload.mergeStrategy).toBe('merge-staging-down-then-exact-sha');
		expect(result.payload.verification.status).toBe('skipped');
		expect(result.payload.promotion.status).toBe('completed');
		expect(result.payload.stagingRefs.status).toBe('verified');
		expect(result.payload.cleanup.status).toBe('skipped');
		expect(result.payload.finalBranch).toBe('staging');
		expect(git(work, ['branch', '--show-current'])).toBe('staging');
		expect(git(resolve(work, 'packages', 'sdk'), ['branch', '--show-current'])).toBe('staging');
		expect(git(work, ['branch', '--list', 'feature/demo-task'])).toContain('feature/demo-task');
		expect(git(resolve(work, 'packages', 'sdk'), ['branch', '--list', 'feature/demo-task'])).toContain('feature/demo-task');
		expect(git(fixtureRepo, ['rev-parse', 'origin/staging'])).toBe(git(fixtureRepo, ['rev-parse', 'HEAD']));
		expect(git(templateRepo, ['rev-parse', 'origin/staging'])).toBe(git(templateRepo, ['rev-parse', 'HEAD']));
	}, 180000);

it('surfaces package branch drift and dirty package blockers in status', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		await workflow.switchTask({ branch: 'feature/demo-task' });
		git(resolve(work, 'packages', 'core'), ['checkout', 'staging']);
		writeFileSync(resolve(work, 'packages', 'cli', 'index.js'), 'export const name = "cli-dirty";\n', 'utf8');

		const result = await workflow.status();

		expect(result.payload.packageSync.mode).toBe('recursive-workspace');
		expect(result.payload.packageSync.aligned).toBe(false);
		expect(result.payload.packageSync.dirty).toBe(true);
		expect(result.payload.packageSync.blockers.join('\n')).toContain('@treeseed/core is on staging instead of feature/demo-task.');
		expect(result.payload.packageSync.blockers.join('\n')).toContain('@treeseed/cli has uncommitted changes.');
	}, 180000);

it('treats save with no new changes as a successful sync checkpoint', async () => {
		const { work } = createWorkflowRepo();
		const workflow = workflowFor(work);

		const result = await workflow.save({
			message: 'chore: checkpoint',
			verify: false,
			refreshPreview: false,
		});

		expect(result.ok).toBe(true);
		expect(result.payload.noChanges).toBe(true);
		expect(result.payload.branchSync.pushed).toBe(true);
		expect(result.payload.finalState.branchName).toBe('feature/demo-task');
	}, 180000);

it('uses dev-save mode for staging even when package repos start on main', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		git(work, ['checkout', 'staging']);
		for (const dirName of ['sdk', 'ui', 'core', 'admin', 'cli']) {
			git(resolve(work, 'packages', dirName), ['checkout', 'main']);
		}
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-staging";\n', 'utf8');
		const workflow = workflowFor(work);

		const result = await workflow.save({
			verify: false,
			refreshPreview: false,
			lane: 'promotion',
		});

		expect(result.ok).toBe(true);
		const sdkReport = result.payload.repos.find((repo) => repo.name === '@treeseed/sdk');
		expect(sdkReport?.branch).toBe('staging');
		expect(sdkReport?.branchMode).toBe('package-dev-save');
		expect(sdkReport?.tagName).toBeNull();
		expect(sdkReport?.dependencySpec).toMatch(/^git\+file:\/\/.*sdk\.git#[a-f0-9]{40}$/u);
		expect(result.payload.lane).toBe('promotion');
		expect(result.payload.ciMode).toBe('off');
		expect(result.payload.workflowGates).toEqual([]);
		expect(result.payload.workflowGates).not.toEqual(expect.arrayContaining([
			expect.objectContaining({ name: result.payload.rootRepo.name, workflow: 'verify.yml', branch: 'staging' }),
		]));
		expect(git(resolve(work, 'packages', 'sdk'), ['branch', '--show-current'])).toBe('staging');
		expect(git(resolve(work, 'packages', 'sdk'), ['tag', '--list', '0.4.13'])).toBe('');
	}, 180000);
});
