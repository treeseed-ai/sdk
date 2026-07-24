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
import { readSourceModule, sourceFunctionBody } from '../../../support/workspace-test-root.ts';

describe('treeseed workflow lifecycle: release', () => {
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

it('blocks normal patch releases when public package release lines are drifted', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		git(work, ['checkout', 'staging']);
		setPackageVersion(resolve(work, 'packages', 'sdk'), '0.10.6');
		setPackageVersion(resolve(work, 'packages', 'ui'), '0.9.4');
		setPackageVersion(resolve(work, 'packages', 'core'), '0.9.4');
		setPackageVersion(resolve(work, 'packages', 'admin'), '0.9.4');
		setPackageVersion(resolve(work, 'packages', 'cli'), '0.9.3');
		setPackageVersion(resolve(work, 'packages', 'agent'), '0.9.3');
		git(work, ['add', 'packages/sdk', 'packages/ui', 'packages/core', 'packages/admin', 'packages/cli', 'packages/agent']);
		git(work, ['commit', '-m', 'test: drift public package lines']);
		git(work, ['push', 'origin', 'staging']);
		writePassingStageCandidate(work);

		const plan = await workflow.release({ bump: 'patch', plan: true });

		expect(plan.payload.blockers.join('\n')).toContain('Public package version line drift detected');
		await expect(workflow.release({ bump: 'patch', ciMode: 'off' })).rejects.toThrow('Public package version line drift detected');
		await expect(workflow.release({
			bump: 'patch',
			repairVersionLine: true,
			targetVersionLine: '0.11',
			plan: true,
		})).rejects.toThrow('Release line repair target must match the highest current public package line');
	}, 360000);

it('blocks release gate execution when staging state is not ready', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		await workflow.switchTask({ branch: 'feature/demo-task' });
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-release-auto-resume";\n', 'utf8');
		writeFileSync(resolve(work, 'feature.txt'), 'demo\nrelease auto resume\n', 'utf8');
		await workflow.save({
			message: 'feat: release auto resume sdk change',
			verify: false,
			refreshPreview: false,
		});
		await workflow.stage({
			message: 'stage: release auto resume sdk change',
			async: true,
		});
		writePassingStageCandidate(work);
		writeFileSync(resolve(work, 'release-blocker.txt'), 'not ready\n', 'utf8');

		await expect(workflow.release({ bump: 'patch', ciMode: 'off' })).rejects.toThrow('@treeseed/market has uncommitted changes');
		const recoverResult = await workflow.recover();
		expect(recoverResult.payload.interruptedRuns).toEqual([]);
	}, 300000);

it('classifies stale release runs and prunes them from resumable recovery', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		const currentHead = git(work, ['rev-parse', 'HEAD']);
		createWorkflowRunJournal(work, {
			runId: 'release-stale-test',
			command: 'release',
			input: { bump: 'patch' },
			session: {
				root: work,
				mode: 'recursive-workspace',
				branchName: 'staging',
				repos: [
					{ name: '@treeseed/market', path: work, branchName: 'staging' },
					{ name: '@treeseed/sdk', path: resolve(work, 'packages/sdk'), branchName: 'staging' },
				],
			},
			steps: [
				{ id: 'release-plan', description: 'Record release plan', repoName: '@treeseed/market', repoPath: work, branch: 'staging', resumable: true },
				{ id: 'release-root', description: 'Release market repo', repoName: '@treeseed/market', repoPath: work, branch: 'staging', resumable: true },
			],
		});
		updateWorkflowRunJournal(work, 'release-stale-test', (journal) => ({
			...journal,
			status: 'failed',
			failure: { code: 'unsupported_state', message: 'old release failed', details: null, at: new Date().toISOString() },
			steps: journal.steps.map((step) => step.id === 'release-plan'
				? {
					...step,
					status: 'completed',
					completedAt: new Date().toISOString(),
					data: {
						rootRepo: { name: '@treeseed/market', commitSha: 'old-root-head' },
						repos: [{ name: '@treeseed/sdk', commitSha: git(resolve(work, 'packages/sdk'), ['rev-parse', 'HEAD']) }],
						packageSelection: { selected: ['@treeseed/sdk'] },
					},
				}
				: step),
		}));
		expect(currentHead).not.toBe('old-root-head');

		const recover = await workflow.recover();
		expect(recover.payload.interruptedRuns.map((run: { runId: string }) => run.runId)).not.toContain('release-stale-test');
		expect(recover.payload.staleRuns.map((run: { runId: string }) => run.runId)).toContain('release-stale-test');

		const pruned = await workflow.recover({ pruneStale: true });
		expect(pruned.payload.prunedRuns.map((run: { runId: string }) => run.runId)).toContain('release-stale-test');

		const finalRecover = await workflow.recover();
		expect(finalRecover.payload.staleRuns.map((run: { runId: string }) => run.runId)).not.toContain('release-stale-test');

		createWorkflowRunJournal(work, {
			runId: 'release-obsolete-test',
			command: 'release',
			input: { bump: 'patch' },
			session: {
				root: work,
				mode: 'recursive-workspace',
				branchName: 'staging',
				repos: [{ name: '@treeseed/market', path: work, branchName: 'staging' }],
			},
			steps: [
				{ id: 'release-plan', description: 'Record release plan', repoName: '@treeseed/market', repoPath: work, branch: 'staging', resumable: true },
			],
		});
		updateWorkflowRunJournal(work, 'release-obsolete-test', (journal) => ({
			...journal,
			status: 'failed',
			failure: { code: 'unsupported_state', message: 'operator obsolete test', details: null, at: new Date().toISOString() },
		}));

		const obsolete = await workflow.recover({ obsoleteRunId: 'release-obsolete-test', obsoleteReason: 'superseded by test' });

		expect(obsolete.payload.markedObsoleteRun).toMatchObject({ runId: 'release-obsolete-test', reason: 'superseded by test' });
		expect(obsolete.payload.interruptedRuns.map((run: { runId: string }) => run.runId)).not.toContain('release-obsolete-test');
		expect(obsolete.payload.obsoleteRuns).not.toContainEqual(expect.objectContaining({ status: 'completed' }));
		expect(obsolete.payload.obsoleteRuns).not.toContainEqual(expect.objectContaining({
			classification: expect.objectContaining({ archivedAt: expect.any(String) }),
		}));
	}, 360000);

it('includes starter templates and shared fixtures in release helper repo plans', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		git(work, ['checkout', 'staging']);
		const fixtureRepo = addStaleNestedSubmodule(resolve(work, 'packages', 'sdk'), '.fixtures/treeseed-fixtures', 'staging');
		git(fixtureRepo, ['pull', '--ff-only', 'origin', 'staging']);
		git(resolve(work, 'packages', 'sdk'), ['add', '-A']);
		git(resolve(work, 'packages', 'sdk'), ['commit', '-m', 'test: add planned helper fixture']);
		git(resolve(work, 'packages', 'sdk'), ['push', 'origin', 'staging']);
		const templateRepo = addStaleNestedSubmodule(work, 'starters/research', 'staging');
		git(templateRepo, ['pull', '--ff-only', 'origin', 'staging']);
		git(work, ['add', '.gitmodules', 'starters/research', 'packages/sdk']);
		git(work, ['commit', '-m', 'test: add planned helper repos']);
		git(work, ['push', 'origin', 'staging']);
		writePassingStageCandidate(work);

		const result = await workflow.release({ bump: 'patch', plan: true });

		expect(result.payload.releaseHelperRepos.map((repo: { name: string }) => repo.name)).toEqual(expect.arrayContaining([
			expect.stringMatching(/^fixture:/),
			expect.stringMatching(/^template:/),
		]));
		expect(result.payload.blockers).toEqual([]);
	}, 360000);

it('plans API production image refs from selected API and selected TreeDX metadata changes', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		git(work, ['checkout', 'staging']);
		const treedxRoot = resolve(work, 'packages', 'treedx');
		mkdirSync(resolve(treedxRoot, 'apps', 'api'), { recursive: true });
		writeFileSync(resolve(treedxRoot, 'apps', 'api', 'mix.exs'), 'defmodule TreeDX.MixProject do\n  def project, do: [version: "0.2.20"]\nend\n', 'utf8');
		writeFileSync(resolve(treedxRoot, 'treeseed.package.yaml'), `id: treedx
name: TreeDX
kind: beam-elixir-rust
repository: treeseed-ai/treedx
versionSource: apps/api/mix.exs
image: treeseed/treedx
deploymentSource:
  staging: git
  prod: image
artifacts:
  - provider: docker
    name: treeseed/treedx
  - provider: docker
    name: treeseed/treedx-profiler
`, 'utf8');
		git(treedxRoot, ['add', '-A']);
		git(treedxRoot, ['commit', '-m', 'release: treedx 0.2.20 metadata']);
		git(treedxRoot, ['tag', '0.2.20']);
		git(treedxRoot, ['push', 'origin', 'staging', '0.2.20']);
		git(treedxRoot, ['checkout', 'main']);
		git(treedxRoot, ['merge', '--ff-only', 'staging']);
		git(treedxRoot, ['push', 'origin', 'main']);
		git(treedxRoot, ['checkout', 'staging']);
		writeFileSync(resolve(work, 'packages', 'api', 'index.js'), 'export const name = "api-release";\n', 'utf8');
		git(resolve(work, 'packages', 'api'), ['add', 'index.js']);
		git(resolve(work, 'packages', 'api'), ['commit', '-m', 'fix: api release image refs']);
		git(resolve(work, 'packages', 'api'), ['push', 'origin', 'staging']);
		git(work, ['add', 'packages/api', 'packages/treedx']);
		git(work, ['commit', '-m', 'stage: api release and stable treedx pointer']);
		git(work, ['push', 'origin', 'staging']);
		writePassingStageCandidate(work);

		const result = await workflow.release({ bump: 'patch', plan: true });

			expect(result.payload.packageSelection.selected).toContain('@treeseed/api');
			expect(result.payload.packageSelection.selected).not.toContain('treedx');
			expect(result.payload.releaseImageRefs).toMatchObject({
				TREESEED_API_IMAGE_REF: 'treeseed/api:0.4.13',
				TREESEED_OPERATIONS_RUNNER_IMAGE_REF: 'treeseed/op-runner:0.4.13',
				TREESEED_PUBLIC_TREEDX_IMAGE_REF: 'treeseed/treedx:0.4.12',
			});
	}, 300000);

it('plans release-line repair without bumping packages already on the target line', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		git(work, ['checkout', 'staging']);
		setPackageVersion(resolve(work, 'packages', 'sdk'), '0.10.6');
		setPackageVersion(resolve(work, 'packages', 'ui'), '0.9.4');
		setPackageVersion(resolve(work, 'packages', 'core'), '0.9.4');
		setPackageVersion(resolve(work, 'packages', 'admin'), '0.9.4');
		setPackageVersion(resolve(work, 'packages', 'cli'), '0.9.3');
		setPackageVersion(resolve(work, 'packages', 'agent'), '0.9.3');
		git(work, ['add', 'packages/sdk', 'packages/ui', 'packages/core', 'packages/admin', 'packages/cli', 'packages/agent']);
		git(work, ['commit', '-m', 'test: drift public package lines']);
		git(work, ['push', 'origin', 'staging']);
		writePassingStageCandidate(work);

		const result = await workflow.release({
			bump: 'patch',
			repairVersionLine: true,
			targetVersionLine: '0.10',
			plan: true,
		});

		expect(result.executionMode).toBe('plan');
		expect(result.payload.releaseLine).toMatchObject({
			repair: true,
			targetLine: '0.10',
			highestCurrentLine: '0.10',
			alignedBefore: false,
		});
		expect(result.payload.packageSelection.selected).toEqual(expect.arrayContaining([
			'@treeseed/core',
			'@treeseed/cli',
			'@treeseed/agent',
			'@treeseed/ui',
			'@treeseed/admin',
		]));
		expect(result.payload.plannedVersions).toMatchObject({
			'@treeseed/market': '1.0.1',
			'@treeseed/ui': '0.10.0',
			'@treeseed/core': '0.10.0',
			'@treeseed/admin': '0.10.0',
			'@treeseed/cli': '0.10.0',
			'@treeseed/agent': '0.10.0',
		});
		expect(result.payload.plannedVersions).not.toHaveProperty('@treeseed/sdk');
		expect(result.payload.blockers).toEqual([]);
	}, 360000);

it('releases only changed packages plus dependents and syncs market main to package main heads', async () => {
			const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		git(work, ['checkout', 'staging']);
		const fixtureRepo = addStaleNestedSubmodule(resolve(work, 'packages', 'sdk'), '.fixtures/treeseed-fixtures', 'staging');
		git(fixtureRepo, ['pull', '--ff-only', 'origin', 'staging']);
		git(resolve(work, 'packages', 'sdk'), ['add', '-A']);
		git(resolve(work, 'packages', 'sdk'), ['commit', '-m', 'test: add release helper fixture']);
		git(resolve(work, 'packages', 'sdk'), ['push', 'origin', 'staging']);
		const templateRepo = addStaleNestedSubmodule(work, 'starters/research', 'staging');
		git(templateRepo, ['pull', '--ff-only', 'origin', 'staging']);
		git(work, ['add', '.gitmodules', 'starters/research', 'packages/sdk']);
		git(work, ['commit', '-m', 'test: add release helper repos']);
		git(work, ['push', 'origin', 'staging']);
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-release";\n', 'utf8');
		git(resolve(work, 'packages', 'sdk'), ['add', 'index.js']);
		git(resolve(work, 'packages', 'sdk'), ['commit', '-m', 'feat: release sdk change']);
		git(resolve(work, 'packages', 'sdk'), ['push', 'origin', 'staging']);
		git(work, ['add', 'packages/sdk']);
		const rootPackageJsonPath = resolve(work, 'package.json');
		const rootPackageJson = JSON.parse(readFileSync(rootPackageJsonPath, 'utf8'));
			const sdkCommit = git(resolve(work, 'packages', 'sdk'), ['rev-parse', 'HEAD']);
		rootPackageJson.dependencies = {
			...(rootPackageJson.dependencies ?? {}),
			'@treeseed/sdk': `github:treeseed-ai/sdk#${sdkCommit}`,
		};
		writeFileSync(rootPackageJsonPath, `${JSON.stringify(rootPackageJson, null, 2)}\n`, 'utf8');
		git(work, ['add', 'package.json']);
		git(work, ['commit', '-m', 'stage: root package dependency']);
		git(work, ['push', 'origin', 'staging']);
		git(resolve(work, 'packages', 'sdk'), ['tag', '0.4.13']);
		writePassingStageCandidate(work);
		const result = await workflow.release({ bump: 'patch', ciMode: 'off' });
		const productionValues = loadMachineConfig(work).environments.prod.values;

			const releaseGatePayload = result.payload.releaseGates.gates.payload;
			expect(result.payload.mode).toBe('recursive-workspace');
			expect(releaseGatePayload.mode).toBe('reconcile-release-gates');
			expect(releaseGatePayload.target).toEqual({ kind: 'persistent', scope: 'prod' });
			expect(releaseGatePayload.executionMode).toBe('execute');
		expect(result.payload.packageSelection.selected).toEqual(expect.arrayContaining(['@treeseed/sdk', '@treeseed/core', '@treeseed/admin', '@treeseed/cli']));
		expect(result.payload.plannedVersions).toMatchObject({
			'@treeseed/market': '1.0.1',
			'@treeseed/sdk': '0.4.14',
			'@treeseed/core': '0.4.13',
			'@treeseed/admin': '0.4.13',
		});
			expect(releaseGatePayload.units.map((unit: { unitId: string }) => unit.unitId)).toEqual(expect.arrayContaining([
				'release-gate:verify:@treeseed/sdk',
				'release-gate:production-record:prod',
			]));
			expect(releaseGatePayload.reconcile).toBeTruthy();
		expect(result.payload.managedHelperReleases.status).toBe('completed');
		expect(result.payload.productionImageRefs.persisted).toEqual(result.payload.releaseImageRefs);
		for (const [id, value] of Object.entries(result.payload.releaseImageRefs as Record<string, string>)) {
			expect(productionValues[id]).toBe(value);
		}
		expect(result.payload.managedHelperReleases.repos.map((repo: { name: string }) => repo.name)).toEqual(expect.arrayContaining([
			expect.stringMatching(/^fixture:/),
			expect.stringMatching(/^template:/),
		]));
			expect(releaseGatePayload.plannedSteps.some((step: { action: string }) => step.action === 'update')).toBe(true);
		expect(JSON.parse(readFileSync(resolve(work, 'packages', 'sdk', 'package.json'), 'utf8')).version).toBe('0.4.14');
		expect(JSON.parse(readFileSync(resolve(work, 'packages', 'ui', 'package.json'), 'utf8')).version).toBe('0.4.12');
		expect(git(resolve(work, 'packages', 'sdk'), ['tag', '--list', '0.4.12-dev.*'])).toBe('');
		expect(git(work, ['branch', '--show-current'])).toBe('staging');
		expect(git(resolve(work, 'packages', 'sdk'), ['branch', '--show-current'])).toBe('staging');
		expect(git(resolve(work, 'packages', 'ui'), ['branch', '--show-current'])).toBe('staging');
		expect(git(fixtureRepo, ['rev-parse', 'origin/main'])).toBe(git(fixtureRepo, ['rev-parse', 'origin/staging']));
		expect(git(templateRepo, ['rev-parse', 'origin/main'])).toBe(git(templateRepo, ['rev-parse', 'origin/staging']));
		expect(git(resolve(work, 'packages', 'core'), ['branch', '--show-current'])).toBe('staging');
		expect(git(resolve(work, 'packages', 'admin'), ['branch', '--show-current'])).toBe('staging');
		expect(git(resolve(work, 'packages', 'cli'), ['branch', '--show-current'])).toBe('staging');
	}, 300000);

it('returns a recursive release plan without mutating package or market state', async () => {
		const { work, packages } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		await workflow.switchTask({ branch: 'feature/demo-task' });
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-release-plan";\n', 'utf8');
		writeFileSync(resolve(work, 'feature.txt'), 'demo\nrelease plan\n', 'utf8');
		await workflow.save({
			message: 'feat: release plan sdk change',
			verify: false,
			refreshPreview: false,
		});
		await workflow.stage({
			message: 'stage: release plan sdk change',
			async: true,
		});
		const rootPackageJsonPath = resolve(work, 'package.json');
		const rootPackageJson = JSON.parse(readFileSync(rootPackageJsonPath, 'utf8'));
		const sdkDevVersion = JSON.parse(readFileSync(resolve(work, 'packages', 'sdk', 'package.json'), 'utf8')).version;
		rootPackageJson.dependencies = {
			...(rootPackageJson.dependencies ?? {}),
			'@treeseed/sdk': `git+file://${packages!.sdk.origin}#${sdkDevVersion}`,
		};
		writeFileSync(rootPackageJsonPath, `${JSON.stringify(rootPackageJson, null, 2)}\n`, 'utf8');
		git(work, ['add', 'package.json']);
		git(work, ['commit', '-m', 'stage: root package dependency']);
		writePassingStageCandidate(work);
		const beforeRootHead = git(work, ['rev-parse', 'HEAD']);
		const beforeSdkHead = git(resolve(work, 'packages', 'sdk'), ['rev-parse', 'HEAD']);

		const result = await workflow.release({ bump: 'patch', plan: true });

		expect(result.executionMode).toBe('plan');
		expect(result.payload.mode).toBe('reconcile-release-gates');
		expect(result.payload.target).toEqual({ kind: 'persistent', scope: 'prod' });
		expect(result.payload.rootVersion).toBe('1.0.1');
		expect(result.payload.releaseTag).toBe('1.0.1');
		expect(result.payload.packageSelection.selected).toEqual(expect.arrayContaining(['@treeseed/sdk', '@treeseed/core', '@treeseed/admin', '@treeseed/cli']));
		expect(result.payload.packageSelection.selected).not.toContain('@treeseed/ui');
		expect(result.payload.plannedVersions).toMatchObject({
			'@treeseed/market': '1.0.1',
			'@treeseed/sdk': '0.4.13',
			'@treeseed/core': '0.4.13',
			'@treeseed/admin': '0.4.13',
			'@treeseed/cli': '0.4.12',
			'@treeseed/agent': '0.4.13',
		});
		expect(result.payload.plannedDevReferenceRewrites.some((entry: { repoName: string }) => entry.repoName === '@treeseed/market')).toBe(true);
			expect(result.payload.plannedSteps.map((step: { id: string }) => step.id)).toEqual(expect.arrayContaining([
				'release-gate:verify:@treeseed/sdk',
				'release-gate:production-record:prod',
			]));
		expect(git(work, ['rev-parse', 'HEAD'])).toBe(beforeRootHead);
		expect(git(resolve(work, 'packages', 'sdk'), ['rev-parse', 'HEAD'])).toBe(beforeSdkHead);
		expect(git(resolve(work, 'packages', 'sdk'), ['tag', '--list', '0.4.13'])).toBe('');
	}, 300000);

it('uses package-local deploy workflows as the hosted gate without duplicate verify gates', () => {
		const source = readSourceModule(new URL('../../../../src/workflow/operations.ts', import.meta.url));
		const workflowSource = sourceFunctionBody(source, 'hostedWorkflowsForSavedRepository');
		const gateSource = sourceFunctionBody(source, 'gatesForSavedRepositoryReports');

		expect(workflowSource).toContain('addWorkflow(adapterWorkflow)');
		expect(workflowSource).toContain("workflows.length === 0 && workflowFileExists(repo.path, 'verify.yml')");
		expect(workflowSource).toContain("if (/^deploy(?:[-.]|$)/u.test(normalized)) return");
		expect(workflowSource).not.toContain("addWorkflow('deploy.yml')");
		expect(gateSource).toContain('hostedWorkflowsForSavedRepository');
		expect(gateSource).toContain('.map((workflow) =>');
		expect(gateSource).toContain('return gate');
		expect(gateSource).not.toContain('hostedDeployGate(gate)');
	});
});
