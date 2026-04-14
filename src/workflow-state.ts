import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTreeseedMachineConfigPaths, resolveTreeseedRemoteSession } from './operations/services/config-runtime.ts';
import {
	createBranchPreviewDeployTarget,
	createPersistentDeployTarget,
	loadDeployState,
} from './operations/services/deploy.ts';
import { PRODUCTION_BRANCH, STAGING_BRANCH } from './operations/services/git-workflow.ts';
import { loadCliDeployConfig } from './operations/services/runtime-tools.ts';
import { collectCliPreflight } from './operations/services/workspace-preflight.ts';
import { gitStatusPorcelain } from './operations/services/workspace-save.ts';
import { isWorkspaceRoot } from './operations/services/workspace-tools.ts';
import type { TreeseedWorkflowNextStep } from './workflow.ts';
import {
	type TreeseedWorkflowBranchRole,
	resolveTreeseedWorkflowPaths,
	workflowEnvironmentForBranchRole,
} from './workflow/policy.ts';

export type TreeseedBranchRole = TreeseedWorkflowBranchRole;

export type TreeseedWorkflowRecommendation = TreeseedWorkflowNextStep;

export type TreeseedWorkflowState = {
	cwd: string;
	workspaceRoot: boolean;
	tenantRoot: boolean;
	deployConfigPresent: boolean;
	repoRoot: string | null;
	branchName: string | null;
	branchRole: TreeseedBranchRole;
	environment: 'local' | 'staging' | 'prod' | 'none';
	dirtyWorktree: boolean;
	preview: {
		enabled: boolean;
		url: string | null;
		lastDeploymentTimestamp: string | null;
	};
	persistentEnvironments: Record<string, {
		initialized: boolean;
		lastValidatedAt: string | null;
		lastDeploymentTimestamp: string | null;
		lastDeployedUrl: string | null;
	}>;
	auth: {
		gh: boolean;
		wrangler: boolean;
		railway: boolean;
		copilot: boolean;
		remoteApi: boolean;
	};
	managedServices: Record<string, {
		enabled: boolean;
		initialized: boolean;
		lastDeploymentTimestamp: string | null;
		lastDeployedUrl: string | null;
		provider: string | null;
	}>;
	files: {
		treeseedConfig: boolean;
		machineConfig: boolean;
		machineKey: boolean;
		envLocal: boolean;
		devVars: boolean;
	};
	releaseReady: boolean;
	readiness: {
		local: { ready: boolean; blockers: string[]; warnings: string[] };
		staging: { ready: boolean; blockers: string[]; warnings: string[] };
		prod: { ready: boolean; blockers: string[]; warnings: string[] };
	};
	rollbackCandidates: Array<{
		scope: 'staging' | 'prod';
		commit: string | null;
		timestamp: string | null;
		url: string | null;
	}>;
	recommendations: TreeseedWorkflowRecommendation[];
};

function emptyPersistentEnvironments(): TreeseedWorkflowState['persistentEnvironments'] {
	return {
		local: { initialized: false, lastValidatedAt: null, lastDeploymentTimestamp: null, lastDeployedUrl: null },
		staging: { initialized: false, lastValidatedAt: null, lastDeploymentTimestamp: null, lastDeployedUrl: null },
		prod: { initialized: false, lastValidatedAt: null, lastDeploymentTimestamp: null, lastDeployedUrl: null },
	};
}

function readinessForEnvironment(state: TreeseedWorkflowState, scope: 'local' | 'staging' | 'prod') {
	const blockers: string[] = [];
	const warnings: string[] = [];

	if (!state.deployConfigPresent) {
		blockers.push('Missing treeseed.site.yaml.');
	}
	if (!state.files.machineConfig) {
		blockers.push('Missing Treeseed machine config.');
	}
	if (scope === 'local') {
		if (!state.files.envLocal) {
			blockers.push('Missing .env.local.');
		}
		if (!state.files.devVars) {
			warnings.push('Missing .dev.vars.');
		}
	} else {
		if (!state.persistentEnvironments[scope].initialized) {
			blockers.push(`Environment ${scope} is not initialized.`);
		}
	}

	return {
		ready: blockers.length === 0,
		blockers,
		warnings,
	};
}

export function resolveTreeseedWorkflowState(cwd: string): TreeseedWorkflowState {
	const resolved = resolveTreeseedWorkflowPaths(cwd);
	const effectiveCwd = resolved.cwd;
	const workspaceRoot = isWorkspaceRoot(effectiveCwd);
	const treeseedConfigPath = resolve(effectiveCwd, 'treeseed.site.yaml');
	const tenantRoot = existsSync(treeseedConfigPath);
	const root = resolved.repoRoot;
	const branchName = resolved.branchName;
	const branchRole = resolved.branchRole;
	const dirtyWorktree = root ? gitStatusPorcelain(root).length > 0 : false;
	const preflight = collectCliPreflight({ cwd: effectiveCwd, requireAuth: false });
	const { configPath, keyPath } = getTreeseedMachineConfigPaths(effectiveCwd);
	const state: TreeseedWorkflowState = {
		cwd: effectiveCwd,
		workspaceRoot,
		tenantRoot,
		deployConfigPresent: tenantRoot,
		repoRoot: root,
		branchName,
		branchRole,
		environment: workflowEnvironmentForBranchRole(branchRole),
		dirtyWorktree,
		preview: {
			enabled: false,
			url: null,
			lastDeploymentTimestamp: null,
		},
		persistentEnvironments: emptyPersistentEnvironments(),
		auth: {
			gh: preflight.checks.auth.gh?.authenticated === true,
			wrangler: preflight.checks.auth.wrangler?.authenticated === true,
			railway: preflight.checks.auth.railway?.authenticated === true,
			copilot: preflight.checks.auth.copilot?.configured === true,
			remoteApi: Boolean(resolveTreeseedRemoteSession(cwd)),
		},
		managedServices: {
			api: { enabled: false, initialized: false, lastDeploymentTimestamp: null, lastDeployedUrl: null, provider: null },
			agents: { enabled: false, initialized: false, lastDeploymentTimestamp: null, lastDeployedUrl: null, provider: null },
			manager: { enabled: false, initialized: false, lastDeploymentTimestamp: null, lastDeployedUrl: null, provider: null },
			worker: { enabled: false, initialized: false, lastDeploymentTimestamp: null, lastDeployedUrl: null, provider: null },
			workdayStart: { enabled: false, initialized: false, lastDeploymentTimestamp: null, lastDeployedUrl: null, provider: null },
			workdayReport: { enabled: false, initialized: false, lastDeploymentTimestamp: null, lastDeployedUrl: null, provider: null },
		},
		files: {
			treeseedConfig: tenantRoot,
			machineConfig: existsSync(configPath),
			machineKey: existsSync(keyPath),
			envLocal: existsSync(resolve(cwd, '.env.local')),
			devVars: existsSync(resolve(cwd, '.dev.vars')),
		},
		releaseReady: branchRole === 'staging' && !dirtyWorktree,
		readiness: {
			local: { ready: false, blockers: [], warnings: [] },
			staging: { ready: false, blockers: [], warnings: [] },
			prod: { ready: false, blockers: [], warnings: [] },
		},
		rollbackCandidates: [],
		recommendations: [],
	};

	if (tenantRoot) {
		try {
			const deployConfig = loadCliDeployConfig(effectiveCwd);
			for (const scope of ['local', 'staging', 'prod'] as const) {
				const deployState = loadDeployState(effectiveCwd, deployConfig, { target: createPersistentDeployTarget(scope) });
				state.persistentEnvironments[scope] = {
					initialized: deployState.readiness?.initialized === true || scope === 'local',
					lastValidatedAt: deployState.readiness?.lastValidatedAt ?? deployState.readiness?.initializedAt ?? null,
					lastDeploymentTimestamp: deployState.lastDeploymentTimestamp ?? null,
					lastDeployedUrl: deployState.lastDeployedUrl ?? null,
				};
				if (scope !== 'local') {
					const history = Array.isArray((deployState as { deploymentHistory?: unknown[] }).deploymentHistory)
						? ((deployState as { deploymentHistory?: Array<Record<string, unknown>> }).deploymentHistory ?? [])
						: [];
					const latestHistory = history.at(-1) ?? null;
					state.rollbackCandidates.push({
						scope,
						commit: typeof latestHistory?.commit === 'string' ? latestHistory.commit : (deployState.lastDeployedCommit ?? null),
						timestamp: typeof latestHistory?.timestamp === 'string' ? latestHistory.timestamp : (deployState.lastDeploymentTimestamp ?? null),
						url: typeof latestHistory?.url === 'string' ? latestHistory.url : (deployState.lastDeployedUrl ?? null),
					});
				}
					for (const serviceKey of ['api', 'agents', 'manager', 'worker', 'workdayStart', 'workdayReport']) {
						const service = deployState.services?.[serviceKey];
						if (!service) continue;
						state.managedServices[serviceKey] = {
						enabled: service.enabled === true,
						initialized: service.initialized === true,
						lastDeploymentTimestamp: service.lastDeploymentTimestamp ?? null,
						lastDeployedUrl: service.lastDeployedUrl ?? service.publicBaseUrl ?? null,
						provider: service.provider ?? null,
					};
				}
			}

			if (branchRole === 'feature' && branchName) {
				const previewState = loadDeployState(effectiveCwd, deployConfig, { target: createBranchPreviewDeployTarget(branchName) });
				state.preview = {
					enabled: previewState.previewEnabled === true || previewState.readiness?.initialized === true,
					url: previewState.lastDeployedUrl ?? null,
					lastDeploymentTimestamp: previewState.lastDeploymentTimestamp ?? null,
				};
			}
		} catch {
			// Leave deployment state unresolved when the tenant config cannot be loaded yet.
		}
	}

	state.readiness.local = readinessForEnvironment(state, 'local');
	state.readiness.staging = readinessForEnvironment(state, 'staging');
	state.readiness.prod = readinessForEnvironment(state, 'prod');
	state.recommendations = recommendTreeseedNextSteps(state);
	return state;
}

export function recommendTreeseedNextSteps(state: TreeseedWorkflowState): TreeseedWorkflowRecommendation[] {
	const recommendations: TreeseedWorkflowRecommendation[] = [];
	if (!state.workspaceRoot) {
		return [{ operation: 'status', reason: 'Run this from inside a Treeseed workspace so the project root can be resolved.' }];
	}
	if (!state.deployConfigPresent) {
		return [{ operation: 'init', reason: 'Create a new Treeseed tenant before configuring or releasing anything.', input: { directory: '<directory>' } }];
	}
	if (!state.files.machineConfig) {
		recommendations.push({ operation: 'status', reason: 'Validate tooling, auth, and repository readiness first.' });
		recommendations.push({ operation: 'config', reason: 'Bootstrap the local machine config and local environment files.' });
		return recommendations;
	}
	if (state.branchRole === 'feature') {
		recommendations.push({ operation: 'stage', reason: 'Merge this task branch into staging and clean up branch artifacts.', input: { message: 'describe the resolution' } });
		recommendations.push({ operation: 'save', reason: 'Persist, verify, and push the current task branch before or independently of staging it.', input: { message: 'describe your change' } });
		if (state.preview.enabled && state.branchName) {
			recommendations.push({ operation: 'save', reason: 'Save refreshes the branch preview deployment when one is enabled.', input: { message: 'describe your change', preview: true } });
		} else {
			recommendations.push({ operation: 'dev', reason: 'Use the local environment for iterative work on this feature branch.' });
		}
		recommendations.push({ operation: 'close', reason: 'Archive this task without merging if it should be abandoned.', input: { message: 'reason' } });
		return recommendations.slice(0, 3);
	}
	if (state.branchRole === 'staging') {
		if (!state.persistentEnvironments.staging.initialized) {
			recommendations.push({ operation: 'config', reason: 'Initialize the staging environment before releasing.', input: { environment: ['staging'] } });
		} else {
			recommendations.push({ operation: 'release', reason: 'Promote staging into main when the integration branch is ready for production.', input: { bump: 'patch' } });
			if (state.managedServices.api.enabled || state.managedServices.agents.enabled) {
				recommendations.push({ operation: 'auth:login', reason: 'Keep the local runtime authenticated to the remote API used by managed services.' });
			}
		}
		return recommendations.slice(0, 3);
	}
	if (state.branchRole === 'main') {
		if (state.dirtyWorktree) {
			recommendations.push({ operation: 'save', reason: 'Only explicit hotfix saves are allowed on main.', input: { message: 'describe the hotfix', hotfix: true } });
		} else if (!state.persistentEnvironments.prod.initialized) {
			recommendations.push({ operation: 'config', reason: 'Initialize production before a release requires it.', input: { environment: ['prod'] } });
		} else {
			recommendations.push({ operation: 'status', reason: 'Inspect production state and release readiness.' });
			recommendations.push({ operation: 'rollback', reason: 'Roll back production to the previous recorded deployment if needed.', input: { environment: 'prod' } });
		}
		return recommendations.slice(0, 3);
	}
	recommendations.push({ operation: 'dev', reason: 'Start the local Treeseed development environment.' });
	recommendations.push({ operation: 'switch', reason: 'Create a task branch from the latest staging commit.', input: { branch: 'feature/my-change' } });
	return recommendations.slice(0, 3);
}
