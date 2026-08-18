import {
	createGitHubApiClient,
	dispatchGitHubWorkflowRun,
	ensureGitHubActionsEnvironment,
	formatGitHubWorkflowFailure,
	getGitHubRepositoryActionsEnabled,
	getLatestGitHubWorkflowRun,
	listGitHubEnvironmentSecretNames,
	listGitHubEnvironmentVariableNames,
	listGitHubEnvironmentVariables,
	upsertGitHubEnvironmentSecret,
	upsertGitHubEnvironmentVariable,
	waitForGitHubWorkflowRunCompletion,
	ensureGitHubRepository,
	maybeGetGitHubRepository,
	setGitHubRepositoryArchived,
	setGitHubRepositoryActionsEnabled,
	ensureGitHubBranchFromBase,
} from '../../operations/services/repositories/github-api.ts';

export function createReconcileGitHubClient(env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
	return createGitHubApiClient({ env });
}

export async function setReconcileGitHubRepositoryArchived(repository: string, archived: boolean, env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
	return setGitHubRepositoryArchived(repository, archived, { client: createReconcileGitHubClient(env) });
}

export async function observeReconcileGitHubRepository(repository: string, env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
	const client = createReconcileGitHubClient(env);
	try {
		const observed = await maybeGetGitHubRepository(repository, { client });
		if (!observed) return null;
		const actionsEnabled = await getGitHubRepositoryActionsEnabled(repository, { client });
		return { ...observed, actionsEnabled };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (isGitHubAuthError(message)) return { authAvailable: false as const, error: message };
		throw error;
	}
}

export async function ensureReconcileGitHubRepository(input: {
	owner: string;
	name: string;
	description?: string | null;
	homepageUrl?: string | null;
	visibility: 'public' | 'private';
	hasIssues: boolean;
	hasProjects?: boolean;
	hasWiki?: boolean;
	actionsEnabled: boolean;
	defaultBranch?: string;
}, env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
	const client = createReconcileGitHubClient(env);
	const repository = await ensureGitHubRepository(input, { client });
	await setGitHubRepositoryActionsEnabled({ owner: input.owner, name: input.name }, input.actionsEnabled, { client });
	return { ...repository, actionsEnabled: input.actionsEnabled };
}

export async function observeReconcileGitHubBranch(repository: string, branch: string, env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
	const client = createReconcileGitHubClient(env);
	const { owner, name } = repository.includes('/')
		? { owner: repository.split('/')[0], name: repository.split('/')[1] }
		: { owner: '', name: '' };
	try {
		const response = await client.rest.repos.getBranch({ owner, repo: name, branch });
		return { exists: true, repository, branch, sha: response.data.commit.sha, authAvailable: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/not found|404/iu.test(message)) return { exists: false, repository, branch, sha: null, authAvailable: true, error: message };
		if (isGitHubAuthError(message)) return { exists: false, repository, branch, sha: null, authAvailable: false, error: message };
		throw error;
	}
}

export async function ensureReconcileGitHubBranch(repository: string, branch: string, baseBranch: string, env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
	return ensureGitHubBranchFromBase(repository, branch, { baseBranch, client: createReconcileGitHubClient(env) });
}

export async function observeReconcileGitHubWorkflow(repository: string, workflow: string, ref: string, env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
	const client = createReconcileGitHubClient(env);
	const [owner, name] = repository.split('/');
	try {
		const response = await client.rest.repos.getContent({ owner: owner!, repo: name!, path: `.github/workflows/${workflow}`, ref });
		const data = response.data as { sha?: string; type?: string };
		return { exists: !Array.isArray(response.data) && data.type === 'file', repository, workflow, ref, sha: data.sha ?? null, authAvailable: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/not found|404|repository is empty/iu.test(message)) return { exists: false, repository, workflow, ref, sha: null, authAvailable: true, error: message };
		if (isGitHubAuthError(message)) return { exists: false, repository, workflow, ref, sha: null, authAvailable: false, error: message };
		throw error;
	}
}

export async function observeReconcileGitHubBranchRules(repository: string, branch: string, env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
	const client = createReconcileGitHubClient(env);
	const [owner, name] = repository.split('/');
	try {
		const response = await client.rest.repos.getBranchProtection({ owner: owner!, repo: name!, branch });
		const data = response.data as Record<string, any>;
		return {
			exists: true, repository, branch, authAvailable: true,
			enforceAdmins: data.enforce_admins?.enabled === true,
			allowForcePushes: data.allow_force_pushes?.enabled === true,
			allowDeletions: data.allow_deletions?.enabled === true,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/not found|404|branch not protected/iu.test(message)) return { exists: false, repository, branch, authAvailable: true, error: message };
		if (/upgrade to github pro|enable this feature/iu.test(message)) return { exists: false, repository, branch, authAvailable: true, providerLimitation: message };
		if (isGitHubAuthError(message)) return { exists: false, repository, branch, authAvailable: false, error: message };
		throw error;
	}
}

export async function ensureReconcileGitHubBranchRules(repository: string, branch: string, env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
	const client = createReconcileGitHubClient(env);
	const [owner, name] = repository.split('/');
	await client.rest.repos.updateBranchProtection({
		owner: owner!, repo: name!, branch,
		required_status_checks: null,
		enforce_admins: true,
		required_pull_request_reviews: null,
		restrictions: null,
		allow_force_pushes: false,
		allow_deletions: false,
	});
	return { repository, branch, enforceAdmins: true, allowForcePushes: false, allowDeletions: false };
}

function isGitHubAuthError(message: string) {
	return /authentication failed|bad credentials|requires authentication|401|403|forbidden/iu.test(message);
}

export async function observeGitHubEnvironment(repository: string, environment: string, env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
	const client = createReconcileGitHubClient(env);
	try {
		const [environmentRecord, branchPolicyRecord, secretNames, variableNames, variableValues] = await Promise.all([
			client.request('GET /repos/{owner}/{repo}/environments/{environment_name}', {
				owner: repository.split('/')[0]!, repo: repository.split('/')[1]!, environment_name: environment,
			}),
			client.request('GET /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies', {
				owner: repository.split('/')[0]!, repo: repository.split('/')[1]!, environment_name: environment, per_page: 100,
			}).catch(() => ({ data: { branch_policies: [] } })),
			listGitHubEnvironmentSecretNames(repository, environment, { client }),
			listGitHubEnvironmentVariableNames(repository, environment, { client }),
			listGitHubEnvironmentVariables(repository, environment, { client }),
		]);
		return {
			exists: true,
			repository,
			environment,
			secretNames: [...secretNames].sort(),
			variableNames: [...variableNames].sort(),
			variableValues: Object.fromEntries([...variableValues.entries()].sort(([left], [right]) => left.localeCompare(right))),
			deploymentBranchPolicy: (environmentRecord.data as { deployment_branch_policy?: unknown }).deployment_branch_policy ?? null,
			branchPolicies: ((branchPolicyRecord.data as { branch_policies?: Array<{ name?: string; type?: string }> }).branch_policies ?? [])
				.map((policy) => ({ name: policy.name ?? '', type: policy.type ?? 'branch' }))
				.sort((left, right) => `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`)),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/not found|404/iu.test(message)) {
			return {
				exists: false,
				authAvailable: true,
				repository,
				environment,
				secretNames: [],
				variableNames: [],
				variableValues: {},
				deploymentBranchPolicy: null,
				branchPolicies: [],
				error: message,
			};
		}
		if (isGitHubAuthError(message)) {
			return {
				exists: false,
				authAvailable: false,
				repository,
				environment,
				secretNames: [],
				variableNames: [],
				variableValues: {},
				deploymentBranchPolicy: null,
				branchPolicies: [],
				error: message,
			};
		}
		throw error;
	}
}

export async function ensureReconcileGitHubEnvironment(repository: string, environment: string, branchName: string | null, env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
	const client = createReconcileGitHubClient(env);
	return ensureGitHubActionsEnvironment(repository, environment, { client, branchName: branchName ?? undefined });
}

export async function upsertReconcileGitHubSecret(repository: string, environment: string, name: string, value: string, env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
	const client = createReconcileGitHubClient(env);
	return upsertGitHubEnvironmentSecret(repository, environment, name, value, { client });
}

export async function upsertReconcileGitHubVariable(repository: string, environment: string, name: string, value: string, env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
	const client = createReconcileGitHubClient(env);
	return upsertGitHubEnvironmentVariable(repository, environment, name, value, { client });
}

export async function observeGitHubWorkflowRun(input: {
	repository: string;
	workflow: string;
	branch?: string | null;
	env: NodeJS.ProcessEnv | Record<string, string | undefined>;
}) {
	const client = createReconcileGitHubClient(input.env);
	try {
		return await getLatestGitHubWorkflowRun(input.repository, {
			client,
			workflow: input.workflow,
			branch: input.branch,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (isGitHubAuthError(message) || /not found|404/iu.test(message)) {
			return {
				authAvailable: false,
				error: message,
			};
		}
		throw error;
	}
}

export async function dispatchReconcileGitHubWorkflow(input: {
	repository: string;
	workflow: string;
	branch: string;
	inputs?: Record<string, string>;
	wait?: boolean;
	timeoutMs?: number;
	env: NodeJS.ProcessEnv | Record<string, string | undefined>;
}) {
	const client = createReconcileGitHubClient(input.env);
	const dispatch = await dispatchGitHubWorkflowRun(input.repository, {
		client,
		workflow: input.workflow,
		branch: input.branch,
		inputs: input.inputs,
	});
	const latest = await getLatestGitHubWorkflowRun(input.repository, {
		client,
		workflow: input.workflow,
		branch: input.branch,
	});
	const completed = input.wait
		? await waitForGitHubWorkflowRunCompletion(input.repository, {
			client,
			workflow: input.workflow,
			branch: input.branch,
			timeoutSeconds: input.timeoutMs ? Math.ceil(input.timeoutMs / 1000) : undefined,
		})
		: null;
	if (completed && completed.conclusion !== 'success') {
		const failedJob = completed.failedJobs?.[0] ?? completed.jobs?.find((job) => job.conclusion && job.conclusion !== 'success' && job.conclusion !== 'skipped') ?? null;
		const failedStep = failedJob?.steps?.find((step) => step.conclusion && step.conclusion !== 'success' && step.conclusion !== 'skipped') ?? null;
		const failure = formatGitHubWorkflowFailure({
			repository: input.repository,
			workflow: input.workflow,
			runId: completed.runId,
			runUrl: completed.url,
			conclusion: completed.conclusion,
			failedJobName: failedJob?.name,
			lastActiveStep: failedStep?.name,
			message: `GitHub workflow ${input.workflow} in ${input.repository} completed with conclusion ${completed.conclusion ?? 'unknown'}.`,
			resumeSafe: false,
		});
		throw new Error([
			failure.summary,
			failure.runUrl ? `Run: ${failure.runUrl}` : null,
			failure.inspectCommand ? `Inspect: ${failure.inspectCommand}` : null,
		].filter(Boolean).join('\n'));
	}
	return { dispatch, latest, completed };
}
