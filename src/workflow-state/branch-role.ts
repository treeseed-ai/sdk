import { collectPublicPackageReleaseLineState } from "../operations/services/treedx/workspaces/workspace-save.ts";
import { classifyGitMode, runGitText } from "../operations/services/operations/git-runner.ts";
import { packageAdapterPlanSummary } from "../operations/services/reconciliation/package-adapters.ts";
import { inspectWorkspaceDependencyMode } from "../operations/services/treedx/workspaces/workspace-dependency-mode.ts";
import type { WorkflowNextStep } from "../operations/workflow.ts";
import { type WorkflowBranchRole } from "../workflow/policy.ts";


export type BranchRole = WorkflowBranchRole;

export function runGit(args: string[], options: { cwd: string; capture?: boolean; timeoutMs?: number; maxBuffer?: number }) {
	return runGitText(args, {
		cwd: options.cwd,
		mode: classifyGitMode(args),
		timeoutMs: options.timeoutMs,
		maxBuffer: options.maxBuffer,
	});
}

export type WorkflowRecommendation = WorkflowNextStep;

export type WorkflowEnvironmentStatus = {
	phase: string;
	ready: boolean;
	configured: boolean;
	initialized: boolean;
	provisioned: boolean;
	deployable: boolean;
	lastValidatedAt: string | null;
	lastDeploymentTimestamp: string | null;
	lastDeployedUrl: string | null;
	blockers: string[];
	warnings: string[];
};

export type WorkflowProviderCheck = {
	configured: boolean;
	applicable?: boolean;
	detail?: string;
	live?: {
		checked: boolean;
		ready: boolean;
		skipped?: boolean;
		detail: string;
	};
};

export type WorkflowProviderStatus = Record<'local' | 'staging' | 'prod', {
	github: WorkflowProviderCheck;
	cloudflare: WorkflowProviderCheck;
	railway: WorkflowProviderCheck;
	localDevelopment: WorkflowProviderCheck;
}>;

export type WorkflowStatusOptions = {
	live?: boolean;
	history?: 'recent' | 'all';
	env?: NodeJS.ProcessEnv;
};

export type WorkflowState = {
	cwd: string;
	workspaceRoot: boolean;
	tenantRoot: boolean;
	deployConfigPresent: boolean;
	repoRoot: string | null;
	branchName: string | null;
	branchRole: BranchRole;
	environment: 'local' | 'staging' | 'prod' | 'none';
	dirtyWorktree: boolean;
	workflowControl: {
		lock: {
			active: boolean;
			stale: boolean;
			runId: string | null;
			command: string | null;
			updatedAt: string | null;
			staleReason: string | null;
		};
		interruptedRuns: Array<{
			runId: string;
			command: string;
			updatedAt: string;
			nextStep: string | null;
		}>;
		staleRuns: Array<{
			runId: string;
			command: string;
			updatedAt: string;
			nextStep: string | null;
			reasons: string[];
		}>;
		staleRunsTotal: number;
		staleRunsOmitted: number;
		obsoleteRuns: Array<{
			runId: string;
			command: string;
			updatedAt: string;
			reasons: string[];
		}>;
		historyMode: 'recent' | 'all';
		obsoleteRunsTotal: number;
		obsoleteRunsOmitted: number;
		blockers: string[];
	};
	packageSync: {
		mode: 'root-only' | 'recursive-workspace';
		completeCheckout: boolean;
		dependencyMode: string;
		workspaceLinks: ReturnType<typeof inspectWorkspaceDependencyMode>;
		expectedBranch: string | null;
		aligned: boolean;
		dirty: boolean;
		repos: Array<{
			name: string;
			path: string;
			branchName: string | null;
			dirty: boolean;
			aligned: boolean;
			localBranch: boolean;
			remoteBranch: boolean;
			detached: boolean;
			detachedRepair: Record<string, unknown> | null;
		}>;
		blockers: string[];
		warnings: string[];
		releaseLine: ReturnType<typeof collectPublicPackageReleaseLineState> | null;
		packages: ReturnType<typeof packageAdapterPlanSummary>;
	};
	preview: {
		enabled: boolean;
		url: string | null;
		lastDeploymentTimestamp: string | null;
	};
	webCache: {
		webHost: string | null;
		contentHost: string | null;
		sourcePagePolicy: string | null;
		contentPagePolicy: string | null;
		r2ObjectPolicy: string | null;
		cloudflareRulesManaged: boolean;
		lastDeployPurgeAt: string | null;
		lastDeployPurgeCount: number | null;
		lastContentPurgeAt: string | null;
		lastContentPurgeCount: number | null;
	};
	persistentEnvironments: Record<string, {
		initialized: boolean;
		phase: string;
		configured: boolean;
		provisioned: boolean;
		deployable: boolean;
		blockers: string[];
		warnings: string[];
		lastValidatedAt: string | null;
		lastDeploymentTimestamp: string | null;
		lastDeployedUrl: string | null;
	}>;
	environmentStatus: Record<'local' | 'staging' | 'prod', WorkflowEnvironmentStatus>;
	providerStatus: WorkflowProviderStatus;
	auth: {
		gh: boolean;
		wrangler: boolean;
		railway: boolean;
		copilot: boolean;
		remoteApi: boolean;
	};
	marketConnection: {
		configured: boolean;
		baseUrl: string | null;
		hostId: string | null;
		teamId: string | null;
		teamSlug: string | null;
		projectId: string | null;
		projectSlug: string | null;
		connectionMode: string | null;
		projectApiBaseUrl: string | null;
		hubMode: string | null;
		runtimeMode: string | null;
		runtimeRegistration: string | null;
		runtimeAttached: boolean;
		runtimeReady: boolean;
		runnerHostId: string | null;
		runnerReady: boolean;
		runnerRegisteredAt: string | null;
		runnerLastSeenAt: string | null;
		launchPhase: string | null;
		lastSuccessfulPhase: string | null;
		githubRepository: string | null;
		workflowBootstrapReady: boolean;
		currentWorkstreamId: string | null;
		verificationPosture: 'ready' | 'blocked' | 'pending';
		approvalBlockers: string[];
	};
	managedServices: Record<string, {
		enabled: boolean;
		initialized: boolean;
		lastDeploymentTimestamp: string | null;
		lastDeployedUrl: string | null;
		provider: string | null;
	}>;
	files: {
		Config: boolean;
		machineConfig: boolean;
		machineKey: boolean;
	};
	secrets: {
		keyAgentRunning: boolean;
		keyAgentUnlocked: boolean;
		wrappedKeyPresent: boolean;
		migrationRequired: boolean;
		idleTimeoutMs: number;
		idleRemainingMs: number;
		startupPassphraseConfigured: boolean;
	};
	releaseReady: boolean;
	releaseHistory: {
		stagingAheadMain: number | null;
		stagingBehindMain: number | null;
		unreleasedStagingCommits: number | null;
		backMerged: boolean | null;
		detail: string;
	};
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
	recommendations: WorkflowRecommendation[];
};

export function emptyPersistentEnvironments(): WorkflowState['persistentEnvironments'] {
	return {
		local: { initialized: false, phase: 'pending', configured: false, provisioned: false, deployable: false, blockers: [], warnings: [], lastValidatedAt: null, lastDeploymentTimestamp: null, lastDeployedUrl: null },
		staging: { initialized: false, phase: 'pending', configured: false, provisioned: false, deployable: false, blockers: [], warnings: [], lastValidatedAt: null, lastDeploymentTimestamp: null, lastDeployedUrl: null },
		prod: { initialized: false, phase: 'pending', configured: false, provisioned: false, deployable: false, blockers: [], warnings: [], lastValidatedAt: null, lastDeploymentTimestamp: null, lastDeployedUrl: null },
	};
}

export function emptyEnvironmentStatus(): WorkflowState['environmentStatus'] {
	return {
		local: { phase: 'pending', ready: false, configured: false, initialized: false, provisioned: false, deployable: false, lastValidatedAt: null, lastDeploymentTimestamp: null, lastDeployedUrl: null, blockers: [], warnings: [] },
		staging: { phase: 'pending', ready: false, configured: false, initialized: false, provisioned: false, deployable: false, lastValidatedAt: null, lastDeploymentTimestamp: null, lastDeployedUrl: null, blockers: [], warnings: [] },
		prod: { phase: 'pending', ready: false, configured: false, initialized: false, provisioned: false, deployable: false, lastValidatedAt: null, lastDeploymentTimestamp: null, lastDeployedUrl: null, blockers: [], warnings: [] },
	};
}

export function emptyProviderStatus(): WorkflowProviderStatus {
	const emptyScope = () => ({
		github: { configured: false },
		cloudflare: { configured: false },
		railway: { configured: false },
		localDevelopment: { configured: false },
	});
	return {
		local: {
			...emptyScope(),
			railway: { configured: true, applicable: false, detail: 'Railway services run locally in the local environment.' },
		},
		staging: emptyScope(),
		prod: emptyScope(),
	};
}
