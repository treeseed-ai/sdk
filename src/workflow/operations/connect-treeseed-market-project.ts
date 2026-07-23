import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureTreeseedActVerificationTooling, getTreeseedMachineConfigPaths, loadTreeseedMachineConfig, resolveTreeseedRemoteSession, setTreeseedRemoteSession, writeTreeseedMachineConfig } from "../../operations/services/config-runtime.ts";
import { MarketClient } from "../../market-client.ts";
import { STAGING_BRANCH } from "../../operations/services/git-workflow.ts";
import { collectCliPreflight } from "../../operations/services/workspace-preflight.ts";
import { currentBranch, hasMeaningfulChanges, repoRoot } from "../../operations/services/workspace-save.ts";
import { type RepositorySaveReport } from "../../operations/services/repository-save-orchestrator.ts";
import { discoverTreeseedPackageAdapters } from "../../operations/services/package-adapters.ts";
import { archiveWorkflowRun, classifyWorkflowRunJournal, listInterruptedWorkflowRuns, type TreeseedWorkflowRunJournal } from ".././runs.ts";
import { checkedOutWorkspacePackageRepos, type TreeseedWorkflowSession } from ".././session.ts";
import type { TreeseedConfigInput, TreeseedWorkflowOperationId } from "../../workflow.ts";
import { TreeseedWorkflowError, WorkflowOperationHelpers, WorkflowWrite, runGit } from './workflow-write.ts';
import { normalizeConfigScopes, workflowError } from './run-release-production-guarantees.ts';
import { createNextSteps, normalizeOptionalString } from './release-admin-message.ts';
import { buildWorkflowResult } from './create-repo-report.ts';
import { packageHostedVerifyWorkflow } from './gates-for-saved-repository-reports.ts';

export async function connectTreeseedMarketProject(
	helpers: WorkflowOperationHelpers,
	tenantRoot: string,
	input: TreeseedConfigInput,
	context: {
		scopes: ReturnType<typeof normalizeConfigScopes>;
		sync: TreeseedConfigInput['sync'];
		repairs: unknown[];
		preflight: ReturnType<typeof collectCliPreflight>;
		toolHealth: ReturnType<typeof ensureTreeseedActVerificationTooling>;
	},
) {
	const machineConfig = loadTreeseedMachineConfig(tenantRoot) as Record<string, any>;
	const marketSettings = machineConfig.settings?.market && typeof machineConfig.settings.market === 'object'
		? machineConfig.settings.market as Record<string, unknown>
		: {};
	const remoteSettings = machineConfig.settings?.remote && typeof machineConfig.settings.remote === 'object'
		? machineConfig.settings.remote as Record<string, any>
		: { activeHostId: 'official', executionMode: 'prefer-local', hosts: [] };

	const baseUrl = normalizeOptionalString(input.marketBaseUrl)
		?? normalizeOptionalString(marketSettings.baseUrl)
		?? normalizeOptionalString(remoteSettings.hosts?.find?.((entry: Record<string, unknown>) => entry?.official === true)?.baseUrl)
		?? normalizeOptionalString(remoteSettings.hosts?.find?.((entry: Record<string, unknown>) => entry?.id === remoteSettings.activeHostId)?.baseUrl);
	if (!baseUrl) {
		workflowError(
			'config', 			'validation_failed', 			'Treeseed config --connect-market requires a market base URL. Pass --market-base-url or configure an authenticated remote host first.',
		);
	}

	const hostId = normalizeOptionalString(marketSettings.hostId) ?? 'treeseed-market';
	const activeRemoteSession = resolveTreeseedRemoteSession(tenantRoot, hostId)
		?? resolveTreeseedRemoteSession(tenantRoot, remoteSettings.activeHostId)
		?? resolveTreeseedRemoteSession(tenantRoot, 'official');
	const accessToken = normalizeOptionalString(input.marketAccessToken) ?? normalizeOptionalString(activeRemoteSession?.accessToken);
	if (!accessToken) {
		workflowError(
			'config', 			'validation_failed', 			'Treeseed config --connect-market requires a market access token. Authenticate to the TreeSeed control-plane first or pass --market-access-token.',
		);
	}

	const projectId = normalizeOptionalString(input.marketProjectId) ?? normalizeOptionalString(marketSettings.projectId);
	if (!projectId) {
		workflowError(
			'config', 			'validation_failed', 			'Treeseed config --connect-market requires --market-project-id or an existing settings.market.projectId value.',
		);
	}

	const teamId = normalizeOptionalString(input.marketTeamId) ?? normalizeOptionalString(marketSettings.teamId);
	const projectSlug = normalizeOptionalString(input.marketProjectSlug)
		?? normalizeOptionalString(marketSettings.projectSlug)
		?? normalizeOptionalString(machineConfig.project?.slug)
		?? projectId;
	const teamSlug = normalizeOptionalString(input.marketTeamSlug) ?? normalizeOptionalString(marketSettings.teamSlug);
	const projectApiBaseUrl = normalizeOptionalString(input.marketProjectApiBaseUrl) ?? normalizeOptionalString(marketSettings.projectApiBaseUrl);

	const client = new MarketClient({
		profile: { id: hostId, label: 'TreeSeed', baseUrl, kind: 'specialized' },
		accessToken,
	});

	const connectionResult = (await client.upsertProjectConnection(projectId, {
		mode: 'hybrid',
		projectApiBaseUrl,
		executionOwner: 'project_runner',
		metadata: {
			pairingSource: 'treeseed_config_connect_market', 			tenantRoot, 			tenantSlug: normalizeOptionalString(machineConfig.project?.slug), 			repoSlug: normalizeOptionalString(machineConfig.project?.slug), 			teamId, 			teamSlug, 			projectSlug, 			connectedAt: new Date().toISOString(),
		},
		rotateRunnerToken: input.rotateRunnerToken === true,
	})).payload;

	const hosts = Array.isArray(remoteSettings.hosts) ? [...remoteSettings.hosts] : [];
	const updatedHost = {
		id: hostId,
		label: 'TreeSeed',
		baseUrl,
		official: false,
	};
	const existingHostIndex = hosts.findIndex((entry) =>
		String(entry?.id ?? '') === hostId || String(entry?.baseUrl ?? '').replace(/\/+$/u, '') === baseUrl.replace(/\/+$/u, ''),
	);
	if (existingHostIndex >= 0) {
		hosts.splice(existingHostIndex, 1, {
			...hosts[existingHostIndex],
			...updatedHost,
		});
	} else {
		hosts.unshift(updatedHost);
	}

	if (normalizeOptionalString(input.marketAccessToken)) {
		setTreeseedRemoteSession(tenantRoot, {
			hostId, 			accessToken, 			refreshToken: activeRemoteSession?.refreshToken ?? '', 			expiresAt: activeRemoteSession?.expiresAt ?? '', 			principal: activeRemoteSession?.principal ?? null,
		});
	}

	const runnerHostId = `operations-runner:${projectId}`;
	if (connectionResult.runnerToken) {
		setTreeseedRemoteSession(tenantRoot, {
			hostId: runnerHostId, 			accessToken: connectionResult.runnerToken, 			refreshToken: '', 			expiresAt: '',
			principal: {
				id: `runner:${projectId}`,
				displayName: 'TreeSeed Project Runner',
				scopes: [],
				roles: ['project_runner'],
				permissions: [],
				metadata: { projectId },
			},
		});
	}

	machineConfig.settings.remote = {
		...remoteSettings,
		activeHostId: hostId,
		hosts,
	};
	machineConfig.settings.market = {
		baseUrl,
		hostId,
		teamId,
		teamSlug,
		projectId,
		projectSlug,
		projectApiBaseUrl: connectionResult.connection?.projectApiBaseUrl ?? projectApiBaseUrl ?? null,
		connectionMode: connectionResult.connection?.mode ?? 'hybrid',
		executionOwner: connectionResult.connection?.executionOwner ?? 'project_runner',
		runnerHostId,
		runnerReady: Boolean(connectionResult.runnerToken || resolveTreeseedRemoteSession(tenantRoot, runnerHostId)?.accessToken),
		runnerRegisteredAt: connectionResult.connection?.runnerRegisteredAt ?? null,
		runnerLastSeenAt: connectionResult.connection?.runnerLastSeenAt ?? null,
		launchPhase: null,
		lastSuccessfulPhase: null,
		githubRepository: null,
		workflowBootstrapReady: false,
		approvalBlockers: [],
		connectedAt: new Date().toISOString(),
	};
	writeTreeseedMachineConfig(tenantRoot, machineConfig);

	const { configPath, keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	return buildWorkflowResult(
		'config',
		tenantRoot,
		{
			mode: 'connect-market', 			scopes: context.scopes, 			sync: context.sync, 			configPath, 			keyPath, 			repairs: context.repairs, 			preflight: context.preflight, 			toolHealth: context.toolHealth, 			market: machineConfig.settings.market, 			connection: connectionResult.connection, 			runnerTokenIssued: Boolean(connectionResult.runnerToken),
		},
		{
			summary: 'TreeSeed project pairing completed.',
			nextSteps: createNextSteps([
				{ operation: 'status', reason: 'Confirm the new market connection, runner health, and current workstream posture.' },
				{ operation: 'tasks', reason: 'Inspect the branch-backed workstreams that will now sync into the TreeSeed UI.' },
			]),
		},
	);
}

export function maybePrint(write: WorkflowWrite, line: string, stream: 'stdout' | 'stderr' = 'stdout') {
	if (!line) return;
	write(line, stream);
}

export function ensureMessage(operation: TreeseedWorkflowOperationId, message: string | undefined, label: string) {
	const value = String(message ?? '').trim();
	if (!value) {
		workflowError(operation, 'validation_failed', `Treeseed ${operation} requires ${label}.`);
	}
	return value;
}

export function toError(operation: TreeseedWorkflowOperationId, error: unknown): never {
	if (error instanceof TreeseedWorkflowError) {
		throw error;
	}
	if (error instanceof Error) {
		throw new TreeseedWorkflowError(operation, 'unsupported_state', error.message, {
			details: { name: error.name },
			exitCode: (error as { exitCode?: number }).exitCode,
		});
	}
	throw new TreeseedWorkflowError(operation, 'unsupported_state', String(error));
}

export type ActiveWorkflowRun = {
	runId: string;
	session: TreeseedWorkflowSession;
	journal: TreeseedWorkflowRunJournal;
	resumed: boolean;
};

export function workflowSessionSnapshot(session: TreeseedWorkflowSession): TreeseedWorkflowRunJournal['session'] {
	return {
		root: session.root,
		mode: session.mode,
		branchName: session.branchName,
		repos: [session.rootRepo, ...session.packageRepos].map((repo) => ({
			name: repo.name, 			path: repo.path, 			branchName: repo.branchName,
		})),
	};
}

export function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function nextPendingJournalStep(journal: TreeseedWorkflowRunJournal) {
	return journal.steps.find((step) => step.status === 'pending') ?? null;
}

export function findAutoResumableSaveRun(root: string, branch: string | null) {
	if (!branch) return null;
	if (branch === STAGING_BRANCH
		&& (hasMeaningfulChanges(repoRoot(root)) || checkedOutWorkspacePackageRepos(root).some((repo) => hasMeaningfulChanges(repo.dir)))) {
		return null;
	}
	const currentHeads = Object.fromEntries([
		['@treeseed/market', runGit(['rev-parse', 'HEAD'], { cwd: repoRoot(root), capture: true }).trim()],
		...checkedOutWorkspacePackageRepos(root).map((repo) => [
			repo.name,
			runGit(['rev-parse', 'HEAD'], { cwd: repo.dir, capture: true }).trim(),
		] as const),
	]);
	return listInterruptedWorkflowRuns(root).find((journal) => {
		if (journal.command !== 'save' || !journal.resumable || journal.session.branchName !== branch) {
			return false;
		}
		const classification = classifyWorkflowRunJournal(journal, {
			currentBranch: branch, 			currentHeads,
		});
		if (classification.state === 'resumable') {
			return true;
		}
		if (classification.state === 'stale') {
			archiveWorkflowRun(root, journal.runId, {
				...classification,
				reasons: ['save auto-resume skipped stale failed save', ...classification.reasons],
			});
		}
		return false;
	}) ?? null;
}

export function workflowFileExists(repoPath: string, workflow: string) {
	return existsSync(resolve(repoPath, '.github', 'workflows', workflow));
}

export type TreeseedDiscoveredPackageAdapter = ReturnType<typeof discoverTreeseedPackageAdapters>[number];

export function hostedWorkflowsForSavedRepository(root: string, repo: RepositorySaveReport, adapter?: TreeseedDiscoveredPackageAdapter) {
	const workflows: string[] = [];
	const addWorkflow = (workflow: string | null | undefined) => {
		if (!workflow) return;
		const normalized = workflow.trim().replace(/^\.github\/workflows\//u, '');
		if (normalized && !workflows.includes(normalized)) {
			workflows.push(normalized);
		}
	};
	if (repo.branch === STAGING_BRANCH && existsSync(resolve(repo.path, 'treeseed.site.yaml')) && workflowFileExists(repo.path, 'deploy.yml')) {
		addWorkflow('deploy.yml');
	} else {
		const fallbackAdapter = adapter ?? new Map(discoverTreeseedPackageAdapters(root).map((entry) => [resolve(entry.dir), entry])).get(resolve(repo.path));
		const adapterWorkflow = packageHostedVerifyWorkflow(fallbackAdapter);
		addWorkflow(adapterWorkflow);
	}
	if (workflows.length === 0 && workflowFileExists(repo.path, 'verify.yml')) addWorkflow('verify.yml');
	return workflows;
}
