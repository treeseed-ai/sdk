import { compileDesiredResourceGraph, compileDesiredUnitsFromGraph } from "../../../platform/reconciliation/desired-state.ts";
import { planReconciliation, reconcileTarget } from "../../../reconcile/index.ts";
import { createBranchPreviewDeployTarget, loadDeployState } from "../../../operations/services/hosting/deployment/deploy.ts";
import { loadPlatformConfig } from "../../../platform/configuration/config.ts";
import { destroyTargetUnits, type ReconcileResult } from "../../../reconcile/index.ts";
import { type WorkflowRunCommand } from "../../runs.ts";
import { type WorkflowSession } from "../../session.ts";
import type { DestroyInput, WorkflowContext } from "../../../operations/workflow.ts";
import { PublishedArtifactCheck, verifyDockerHubArtifact, verifyGitHubTagArtifact, verifyNpmArtifact, verifySimpleRegistryArtifact } from './collect-release-plan-blockers.ts';
import { sleep } from '../projects/projects-core/connect-market-project.ts';
import { workflowError } from '../commerce/catalog/run-release-production-guarantees.ts';

export async function collectPublishedReleaseArtifactChecks(selectedVersions: Map<string, string>) {
	const checks: PublishedArtifactCheck[] = [];
	const githubRepositories: Record<string, string> = {
		'@treeseed/sdk': 'treeseed-ai/sdk',
		'@treeseed/ui': 'treeseed-ai/ui',
		'@treeseed/core': 'treeseed-ai/core',
		'@treeseed/admin': 'treeseed-ai/admin',
		'@treeseed/cli': 'treeseed-ai/cli',
		'@treeseed/agent': 'treeseed-ai/agent',
		'@treeseed/api': 'treeseed-ai/api',
		treedx: 'treeseed-ai/treedx',
		'@treeseed/treedx': 'treeseed-ai/treedx',
	};
	for (const [packageName, repository] of Object.entries(githubRepositories)) {
		const version = selectedVersions.get(packageName);
		if (version) checks.push(await verifyGitHubTagArtifact(repository, version));
	}
	const npmPackages = ['@treeseed/sdk', '@treeseed/ui', '@treeseed/core', '@treeseed/admin', '@treeseed/cli', '@treeseed/agent'];
	for (const packageName of npmPackages) {
		const version = selectedVersions.get(packageName);
		if (version) checks.push(await verifyNpmArtifact(packageName, version));
	}
	const agentVersion = selectedVersions.get('@treeseed/agent');
	if (agentVersion) {
		for (const image of ['treeseed/agent-manager', 'treeseed/agent-runner']) {
			checks.push(await verifyDockerHubArtifact(image, agentVersion));
		}
	}
	const apiVersion = selectedVersions.get('@treeseed/api');
	if (apiVersion) {
		for (const image of ['treeseed/api', 'treeseed/op-runner']) {
			checks.push(await verifyDockerHubArtifact(image, apiVersion));
		}
	}
	const treedxVersion = selectedVersions.get('treedx') ?? selectedVersions.get('@treeseed/treedx');
	if (treedxVersion) {
		checks.push(await verifyNpmArtifact('@treeseed/treedx', treedxVersion));
		checks.push(await verifySimpleRegistryArtifact({
			kind: 'pypi', 			name: 'treedx', 			version: treedxVersion,
			url: `https://pypi.org/pypi/treedx/${treedxVersion}/json`,
		}));
		checks.push(await verifySimpleRegistryArtifact({
			kind: 'crates', 			name: 'treedx', 			version: treedxVersion,
			url: `https://crates.io/api/v1/crates/treedx/${treedxVersion}`,
		}));
		checks.push(await verifySimpleRegistryArtifact({
			kind: 'hex', 			name: 'treedx', 			version: treedxVersion,
			url: `https://hex.pm/api/packages/treedx/releases/${treedxVersion}`,
		}));
		for (const image of ['treeseed/treedx', 'treeseed/treedx-profiler']) {
			checks.push(await verifyDockerHubArtifact(image, treedxVersion));
		}
	}
	return checks;
}

export async function verifyPublishedReleaseArtifacts(selectedVersions: Map<string, string>): Promise<{ checks: PublishedArtifactCheck[] }> {
	if (process.env.TREESEED_WORKFLOW_RELEASE_GATES_MODE === 'skip') {
		return { checks: [] };
	}
	let checks = await collectPublishedReleaseArtifactChecks(selectedVersions);
	const deadline = Date.now() + 5 * 60 * 1000;
	while (checks.some((check) => !check.ok) && Date.now() < deadline) {
		await sleep(15000);
		checks = await collectPublishedReleaseArtifactChecks(selectedVersions);
	}
	const failures = checks.filter((check) => !check.ok);
	if (failures.length > 0) {
		const rendered = failures
			.map((check) => `${check.id}: ${check.message ?? `registry returned ${check.status ?? 'unknown'}`} (${check.url})`)
			.join('\n');
		workflowError('release', 'validation_failed', `Published release artifact verification failed.\n${rendered}`, {
			details: { checks },
		});
	}
	return { checks };
}

export function assertSessionBranchSafety(
	operation: WorkflowRunCommand,
	session: WorkflowSession,
	{
		requireCleanPackages = false,
		requireCurrentBranch = false,
		allowPackageReposWithoutOrigin = false,
	}: {
		requireCleanPackages?: boolean;
		requireCurrentBranch?: boolean;
		allowPackageReposWithoutOrigin?: boolean;
	} = {},
) {
	const detached = session.managedRepos.filter((repo) => repo.kind !== 'fixture' && repo.detached).map((repo) => repo.name);
	if (detached.length > 0) {
		workflowError(operation, 'validation_failed', `Detached managed repository heads detected: ${detached.join(', ')}.`, {
			details: { detached },
		});
	}
	if (requireCleanPackages) {
		const dirty = session.managedRepos.filter((repo) => repo.dirty).map((repo) => repo.name);
		if (dirty.length > 0) {
			workflowError(operation, 'validation_failed', `Dirty managed repos block ${operation}: ${dirty.join(', ')}.`, {
				details: { dirty },
			});
		}
	}
	if (requireCurrentBranch && session.branchName) {
		const missing = session.managedRepos
			.filter((repo) => repo.kind !== 'fixture')
			.filter((repo) => repo.branchName !== session.branchName)
			.map((repo) => ({ name: repo.name, branchName: repo.branchName }));
		if (missing.length > 0) {
			workflowError(operation, 'validation_failed', `Managed repository branch alignment is required for ${operation}.`, {
				details: { expectedBranch: session.branchName, repos: missing },
			});
		}
	}
	const missingOriginRepos = [
		session.rootRepo,
		...(allowPackageReposWithoutOrigin ? [] : session.managedRepos),
	]
		.filter((repo) => !repo.hasOriginRemote)
		.map((repo) => repo.name);
	if (missingOriginRepos.length > 0 && operation !== 'destroy') {
		workflowError(operation, 'validation_failed', `Missing origin remote on: ${missingOriginRepos.join(', ')}.`, {
			details: { missingOrigin: missingOriginRepos },
		});
	}
}

export function previewStateFor(tenantRoot: string, branchName: string) {
	const deployConfig = loadPlatformConfig({ tenantRoot, environment: 'staging', env: process.env }).deployConfig;
	return loadDeployState(tenantRoot, deployConfig, {
		target: createBranchPreviewDeployTarget(branchName),
	});
}

export function branchPreviewInitialized(tenantRoot: string, branchName: string | null) {
	if (!branchName) return false;
	try {
		return previewStateFor(tenantRoot, branchName).readiness?.initialized === true;
	} catch {
		return false;
	}
}

export async function reconcileWorkflowBranchPreview(
	tenantRoot: string,
	branchName: string,
	context: WorkflowContext,
	{ initialize }: { initialize: boolean },
) {
return reconcileBranchPreview({
		root: tenantRoot,
		branch: branchName,
		planOnly: false,
		execute: true,
		workflowRunId: context.workflow?.resumeRunId ?? undefined,
		initialize,
		env: context.env,
	});
}

export async function reconcileBranchPreview(input: {
	root: string;
	branch: string;
	appId?: string[];
	planOnly: boolean;
	execute: boolean;
	workflowRunId?: string;
	initialize?: boolean;
	env?: NodeJS.ProcessEnv;
}): Promise<{
	status: 'planned' | 'reconciled';
	branch: string;
	initialize: boolean;
	reconcile: Awaited<ReturnType<typeof planReconciliation>> | Awaited<ReturnType<typeof reconcileTarget>>;
}> {
	const target = { kind: 'branch' as const, branchName: input.branch };
	const graph = compileDesiredResourceGraph({ tenantRoot: input.root, target });
	const selector = {
		environment: 'staging' as const,
		resourceKind: ['branch-preview'],
		...(input.appId?.length ? { appId: input.appId } : {}),
	};
	const units = compileDesiredUnitsFromGraph(graph, selector);
	const planOnly = input.planOnly || !input.execute;
	const reconcile = planOnly
		? await planReconciliation({ tenantRoot: input.root, target, env: input.env ?? process.env, units, selector })
		: await reconcileTarget({
			tenantRoot: input.root, 			target, 			env: input.env ?? process.env, 			units, 			selector, 			planOnly: false,
		});
	return {
		status: planOnly ? 'planned' : 'reconciled',
		branch: input.branch,
		initialize: input.initialize === true,
		reconcile,
	};
}

export async function destroyWorkflowBranchPreviewIfPresent(tenantRoot: string, branchName: string, context?: WorkflowContext) {
return destroyBranchPreview({
		root: tenantRoot,
		branch: branchName,
		planOnly: false,
		execute: true,
		reason: 'close',
		env: context?.env,
	});
}

export async function destroyBranchPreview(input: {
	root: string;
	branch: string;
	planOnly: boolean;
	execute: boolean;
	reason: 'close' | 'branch-delete' | 'expired' | 'manual';
	env?: NodeJS.ProcessEnv;
}): Promise<{
	status: 'planned' | 'destroyed';
	branch: string;
	reason: string;
	reconcile: Awaited<ReturnType<typeof planReconciliation>> | { target: { kind: 'branch'; branchName: string }; results: ReconcileResult[] };
}> {
	const target = { kind: 'branch' as const, branchName: input.branch };
	const graph = compileDesiredResourceGraph({ tenantRoot: input.root, target });
	const selector = {
		environment: 'staging' as const,
		resourceKind: ['branch-preview', 'branch-preview-cleanup'],
	};
	const units = compileDesiredUnitsFromGraph(graph, selector).map((unit) =>
		unit.unitType === 'branch-preview-cleanup'
			? { ...unit, spec: { ...unit.spec, reason: input.reason } }
			: unit);
	const planOnly = input.planOnly || !input.execute;
	const reconcile = planOnly
		? await planReconciliation({ tenantRoot: input.root, target, env: input.env ?? process.env, units, selector })
		: await destroyTargetUnits({
			tenantRoot: input.root, 			target, 			env: input.env ?? process.env, 			units, 			selector,
		});
	return {
		status: planOnly ? 'planned' : 'destroyed',
		branch: input.branch,
		reason: input.reason,
		reconcile,
	};
}

export function resolveDestroyConfirmation(
	context: WorkflowContext,
	expected: string,
	input: DestroyInput,
) {
	if (input.plan) {
		return true;
	}
	if (input.confirm === true) {
		return true;
	}
	if (typeof input.confirm === 'string') {
		return input.confirm === expected;
	}
	if (context.confirm) {
		return context.confirm(
			`Destroy Treeseed environment by confirming "${expected}"`,
			expected,
		);
	}
	return false;
}
