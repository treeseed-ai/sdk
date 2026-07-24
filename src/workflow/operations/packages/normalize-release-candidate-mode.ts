import { type ReconcileSelector } from "../../../reconcile/index.ts";
import { resolveMachineEnvironmentValues } from "../../../operations/services/configuration/config-runtime.ts";
import { createPersistentDeployTarget, resolveConfiguredSurfaceDomain } from "../../../operations/services/hosting/deployment/deploy.ts";
import { PRODUCTION_BRANCH, STAGING_BRANCH } from "../../../operations/services/operations/git-workflow.ts";
import { resolveGitHubRepositorySlug } from "../../../operations/services/repositories/github-automation.ts";
import { resolveGitHubCredentialForRepository } from "../../../operations/services/configuration/github-credentials.ts";
import { formatGitHubActionsGateFailure, isRetryableGitHubActionsSetupFailure, rerunGitHubActionsFailedJobs, skippedGitHubActionsGate, waitForGitHubActionsGate, type GitHubActionsWorkflowGate } from "../../../operations/services/repositories/github-actions-verification.ts";
import { compileHostingGraph } from "../../../hosting/graph.ts";
import { cacheWorkflowGateResult, getCachedSuccessfulWorkflowGate } from "../../runs.ts";
import { effectiveWorkflowWorktreeMode, isManagedWorkflowWorktree, managedWorkflowWorktreeMetadata } from "../../worktrees.ts";
import type { SaveInput, SwitchInput, WorkflowCiMode, WorkflowOperationId, WorkflowWorktreeMode } from "../../../operations/workflow.ts";
import { ReleaseCandidateMode, WorkflowOperationHelpers, normalizeSaveLane } from '../recovery/workflow-write.ts';
import { workflowError } from '../commerce/catalog/run-release-production-guarantees.ts';
import { githubRepositoryForRepo } from './release-admin-message.ts';

export function normalizeReleaseCandidateMode(
	mode: SaveInput['releaseCandidate'] | undefined,
	operation: Extract<WorkflowOperationId, 'save' | 'stage' | 'release'>,
	lane: 'fast' | 'promotion' = 'fast',
): ReleaseCandidateMode {
	const value = mode ?? process.env.TREESEED_RELEASE_CANDIDATE_MODE;
	if (value === 'hybrid' || value === 'strict' || value === 'skip') {
		return value;
	}
	return operation === 'save' ? 'skip' : 'strict';
}

export function shouldUseHostedSaveCi(input: SaveInput, branch: string | null | undefined, lane: 'fast' | 'promotion' = normalizeSaveLane(input.lane)) {
	void input;
	void branch;
	void lane;
	return false;
}

export function worktreePayload(root: string, requestedMode?: WorkflowWorktreeMode) {
	const metadata = managedWorkflowWorktreeMetadata(root);
	return {
		worktreeMode: requestedMode ?? 'auto',
		managedWorktree: metadata,
		worktreePath: metadata?.worktreePath ?? null,
		primaryRoot: metadata?.primaryRoot ?? null,
	};
}

export function helpersForCwd(helpers: WorkflowOperationHelpers, cwd: string): WorkflowOperationHelpers {
	return {
		...helpers,
		context: {
			...helpers.context, 			cwd,
		},
		cwd: () => cwd,
	};
}

export function shouldDispatchSwitchToManagedWorktree(root: string, input: SwitchInput, env: NodeJS.ProcessEnv | undefined) {
	return !isManagedWorkflowWorktree(root)
		&& effectiveWorkflowWorktreeMode(input.worktreeMode, env) === 'on';
}

export function assertHostedGitHubWorkflowCredentialsReady(
	operation: WorkflowOperationId,
	root: string,
	gates: GitHubActionsWorkflowGate[],
) {
	const missing: Array<{ name: string; repository: string; envName: string }> = [];
	for (const gate of gates) {
		const repository = gate.repository ?? resolveGitHubRepositorySlug(gate.repoPath);
		const scope = gate.branch === PRODUCTION_BRANCH ? 'prod' : 'staging';
		const values = resolveMachineEnvironmentValues(root, scope);
		const credential = resolveGitHubCredentialForRepository(repository, { values, env: process.env });
		if (!credential.token) {
			missing.push({ name: gate.name, repository: credential.repository, envName: credential.envName });
		}
	}
	if (missing.length === 0) return;
	workflowError(
		operation,
		'github_auth_unavailable',
		[
			'Treeseed hosted GitHub workflow gates require Treeseed-prefixed GitHub credentials.',
			...missing.map((gate) => `- ${gate.name}: configure ${gate.envName} for ${gate.repository}, or TREESEED_GITHUB_TOKEN as a fallback.`),
		].join('\n'),
		{ details: { missing } },
	);
}

export async function waitForWorkflowGates(
	operation: WorkflowOperationId,
	gates: GitHubActionsWorkflowGate[],
	ciMode: WorkflowCiMode,
	options: {
		root?: string;
		runId?: string;
		onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
		retryFailedOnce?: boolean;
	} = {},
) {
	if (ciMode === 'off' || process.env.TREESEED_STAGE_WAIT_MODE === 'skip') {
		return gates.map((gate) => skippedGitHubActionsGate(gate, 'disabled'));
	}
	if (gates.length === 0) {
		return [];
	}
	if (operation === 'save' && gates.every((gate) => !gate.repository && githubRepositoryForRepo(gate.repoPath) == null)) {
		return gates.map((gate) => skippedGitHubActionsGate(gate, 'non-github-repository'));
	}
	assertHostedGitHubWorkflowCredentialsReady(operation, options.root ?? gates[0]!.repoPath, gates);
	const results: Array<Record<string, unknown>> = [];
	for (const gate of gates) {
		const gateWithTimeout = {
			...gate, 			timeoutSeconds: gate.timeoutSeconds ?? HOSTED_WORKFLOW_GATE_TIMEOUT_SECONDS,
		};
		if (options.root && options.runId) {
			const cached = getCachedSuccessfulWorkflowGate(options.root, options.runId, {
				repository: gateWithTimeout.repository ?? null, 				workflow: gateWithTimeout.workflow, 				headSha: gateWithTimeout.headSha, 				branch: gateWithTimeout.branch,
			});
			if (cached) {
				results.push({
					...cached.result, 					name: gateWithTimeout.name, 					cached: true,
				});
				continue;
			}
		}
		const gateEnv = githubWorkflowGateEnv(options.root, gateWithTimeout);
		let result = await waitForGitHubActionsGate(gateWithTimeout, {
			operation, 			env: gateEnv, 			onProgress: options.onProgress,
		});
		if (result.status === 'completed' && result.conclusion !== 'success' && isRetryableGitHubActionsSetupFailure(result)) {
			const retry = await rerunGitHubActionsFailedJobs(result, gateEnv);
			options.onProgress?.(`[${operation}][gate][${gateWithTimeout.name}] Retrying GitHub-hosted setup failure once for run ${retry.runId}.`);
			result = await waitForGitHubActionsGate(gateWithTimeout, {
				operation, 				env: gateEnv, 				onProgress: options.onProgress,
			});
		} else if (result.status === 'completed' && result.conclusion !== 'success' && options.retryFailedOnce) {
			const retry = await rerunGitHubActionsFailedJobs(result, gateEnv);
			options.onProgress?.(`[${operation}][gate][${gateWithTimeout.name}] Retrying failed jobs once for adopted immutable release run ${retry.runId}.`);
			result = await waitForGitHubActionsGate(gateWithTimeout, {
				operation, 				env: gateEnv, 				onProgress: options.onProgress,
			});
		}
		const normalized = {
			name: gateWithTimeout.name, 			...result, 			workflow: String(result.workflow ?? gateWithTimeout.workflow), 			branch: String(result.branch ?? gateWithTimeout.branch), 			headSha: String(result.headSha ?? gateWithTimeout.headSha), 			timeoutSeconds: gateWithTimeout.timeoutSeconds, 			cached: false,
		};
		if (normalized.status === 'completed' && normalized.conclusion !== 'success') {
			workflowError(operation, 'github_workflow_failed', formatGitHubActionsGateFailure(gateWithTimeout, normalized), {
				details: { gate: gateWithTimeout, workflow: normalized },
			});
		}
		if (options.root && options.runId && normalized.status === 'completed' && normalized.conclusion === 'success') {
			cacheWorkflowGateResult(options.root, options.runId, normalized);
		}
		results.push(normalized);
	}
	return results;
}

export function githubWorkflowGateEnv(root: string | undefined, gate: GitHubActionsWorkflowGate) {
	if (!root) return process.env;
	try {
		const repository = gate.repository ?? resolveGitHubRepositorySlug(gate.repoPath);
		const scope = gate.branch === PRODUCTION_BRANCH ? 'prod' : 'staging';
		const values = resolveMachineEnvironmentValues(root, scope);
		const credential = resolveGitHubCredentialForRepository(repository, { values, env: process.env });
		if (!credential.token) return process.env;
		return {
			...process.env, 			TREESEED_GITHUB_TOKEN: credential.token, 			GH_TOKEN: credential.token, 			GITHUB_TOKEN: credential.token,
		};
	} catch {
		return process.env;
	}
}

export const HOSTED_DEPLOY_GATE_TIMEOUT_SECONDS = 45 * 60;

export const HOSTED_WORKFLOW_GATE_TIMEOUT_SECONDS = 45 * 60;

export function hostedDeployGate(gate: GitHubActionsWorkflowGate): GitHubActionsWorkflowGate {
	return {
		...gate,
		timeoutSeconds: gate.timeoutSeconds ?? HOSTED_DEPLOY_GATE_TIMEOUT_SECONDS,
	};
}

export function saveHostedEnvironmentForBranch(branch: string | null | undefined) {
	if (branch === STAGING_BRANCH) return 'staging' as const;
	if (branch === PRODUCTION_BRANCH) return 'prod' as const;
	return null;
}

export function selectorFromWorkflowHostingGraph(graph: ReturnType<typeof compileHostingGraph>): ReconcileSelector {
	const includesApi = graph.units.some((unit) => unit.id === 'api' || unit.config.serviceName === 'treeseed-api');
	const scope = graph.environment;
	const target = createPersistentDeployTarget(scope);
	const webDomain = resolveConfiguredSurfaceDomain(graph.deployConfig, target, 'web');
	const apiDomain = resolveConfiguredSurfaceDomain(graph.deployConfig, target, 'api');
	const domainServiceIds = [
		webDomain,
		webDomain ? `web:${webDomain}` : null,
		apiDomain,
		apiDomain ? `api:${apiDomain}` : null,
	];
	return {
		host: [...new Set([
			...graph.units.map((unit) => unit.host.id),
			...(includesApi ? ['cloudflare-dns'] : []),
		].filter((hostId) => hostId !== 'smtp' && hostId !== 'local-process' && hostId !== 'local-docker'))],
		serviceId: [...new Set(graph.units.flatMap((unit) => [
			unit.id, 			typeof unit.config.poolKey === 'string' ? unit.config.poolKey : null, 			typeof unit.config.serviceName === 'string' ? unit.config.serviceName : null,
		]).concat(domainServiceIds).filter((value): value is string => Boolean(value)))],
		serviceType: [...new Set(graph.units.flatMap((unit) => {
			if (unit.id === 'api') return ['api-runtime', 'railway-service:api', 'custom-domain:api', 'dns-record'];
			if (unit.id === 'operationsRunner' || unit.config.poolKey === 'operationsRunner') return ['operations-runner-runtime', 'railway-service:operations-runner'];
			if (unit.placement === 'runner-capacity') return ['api-runtime', 'operations-runner-runtime', 'railway-service:api', 'railway-service:operations-runner'];
			if (unit.host.id === 'cloudflare') return ['web-ui', 'edge-worker', 'content-store', 'database', 'kv-form-guard', 'turnstile-widget', 'pages-project', 'custom-domain:web', 'dns-record'];
			return [];
		}))],
	};
}
