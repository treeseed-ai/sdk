import {
	createGitHubApiClient,
	dispatchGitHubWorkflowRun,
	ensureGitHubActionsEnvironment,
	formatGitHubWorkflowFailure,
	getLatestGitHubWorkflowRun,
	listGitHubEnvironmentSecretNames,
	listGitHubEnvironmentVariableNames,
	upsertGitHubEnvironmentSecret,
	upsertGitHubEnvironmentVariable,
	waitForGitHubWorkflowRunCompletion,
} from '../../operations/services/github-api.ts';

export function createReconcileGitHubClient(env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
	return createGitHubApiClient({ env });
}

function isGitHubAuthError(message: string) {
	return /authentication failed|bad credentials|requires authentication|401|403|forbidden/iu.test(message);
}

export async function observeGitHubEnvironment(repository: string, environment: string, env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
	const client = createReconcileGitHubClient(env);
	try {
		const [secretNames, variableNames] = await Promise.all([
			listGitHubEnvironmentSecretNames(repository, environment, { client }),
			listGitHubEnvironmentVariableNames(repository, environment, { client }),
		]);
		return {
			exists: true,
			repository,
			environment,
			secretNames: [...secretNames].sort(),
			variableNames: [...variableNames].sort(),
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
