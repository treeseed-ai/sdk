import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { runRepositoryGit } from '../operations/git-runner.ts';
import { resolveEnvironmentRegistry } from '../../../platform/configuration/environment.ts';
import { packageRoot, loadCliDeployConfig } from '../agents/runtime-tools.ts';
import {
	filterManagedHostGitHubEnvironment,
	usesManagedHostOperationRequests,
} from '../hosting/audit/managed-host-security.ts';
import {
	createGitHubApiClient,
	ensureGitHubRepository,
	maybeGetGitHubRepository,
	parseGitHubRepositorySlug,
	listGitHubRepositorySecretNames,
	listGitHubRepositoryVariableNames,
	upsertGitHubRepositorySecret,
	upsertGitHubRepositoryVariable,
	waitForGitHubWorkflowRunCompletion,
} from '../repositories/github-api.ts';
import { resolveGitHubToken } from '../../../configuration/service-credentials.ts';
import { getGitHubAutomationMode, maybeResolveGitHubRepositorySlug, resolveGitHubRepositorySlug } from './git-hub-repository-provision-input.ts';
import { ensureStandardizedGitHubWorkflows, formatMissingSecretsReport, requiredGitHubEnvironment } from './ensure-git-hub-bootstrap-repository.ts';

export function nonEmptyValues(values = {}) {
	return Object.fromEntries(
		Object.entries(values)
			.filter(([, value]) => typeof value === 'string' && value.length > 0),
	);
}

export async function ensureGitHubEnvironment(tenantRoot, { planOnly = false, scope = 'prod', purpose = 'save', valuesOverlay = {}, managedHostMode = 'auto' } = {}) {
	const repository = maybeResolveGitHubRepositorySlug(tenantRoot);
	if (!repository) {
		if (planOnly) {
			return {
				repository: null,
				secrets: { existing: [], created: [] },
				variables: { existing: [], created: [] },
				skipped: 'missing_repository',
			};
		}
		throw new Error('Unable to determine GitHub repository from the current tenant. Configure an origin remote before syncing GitHub secrets.');
	}
	const required = requiredGitHubEnvironment(tenantRoot, { scope, purpose, managedHostMode });
	const requiredSecrets = required.secrets;
	const requiredVariables = required.variables;
	const client = createGitHubApiClient();
	const existingSecrets = await listGitHubRepositorySecretNames(repository, { client });
	const existingVariables = await listGitHubRepositoryVariableNames(repository, { client });
	const missingRemote = requiredSecrets.filter((name) => !existingSecrets.has(name));
	const missingRemoteVariables = requiredVariables.filter((name) => !existingVariables.has(name));

	const resolvedValues = {
		...process.env,
		...nonEmptyValues(valuesOverlay),
	};
	const localValue = (name) => {
		const value = resolvedValues[name];
		return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
	};
	const missingLocal = missingRemote
		.filter((name) => !localValue(name))
		.map((name) => ({ name, localEnvPresent: false, remotePresent: false }));
	const missingLocalVariables = missingRemoteVariables
		.filter((name) => !localValue(name))
		.map((name) => ({ name, localEnvPresent: false, remotePresent: false }));

	if (missingLocal.length > 0 || missingLocalVariables.length > 0) {
		throw new Error(formatMissingSecretsReport(repository, [...missingLocal, ...missingLocalVariables]));
	}

	const createdSecrets = [];
	for (const name of missingRemote) {
		if (planOnly) {
			createdSecrets.push(name);
			continue;
		}
		await upsertGitHubRepositorySecret(repository, name, localValue(name), { client });
		createdSecrets.push(name);
	}

	const createdVariables = [];
	for (const name of missingRemoteVariables) {
		if (planOnly) {
			createdVariables.push(name);
			continue;
		}
		await upsertGitHubRepositoryVariable(repository, name, localValue(name), { client });
		createdVariables.push(name);
	}

	return {
		repository,
		secrets: {
			existing: requiredSecrets.filter((name) => existingSecrets.has(name)),
			created: createdSecrets,
		},
		variables: {
			existing: requiredVariables.filter((name) => existingVariables.has(name)),
			created: createdVariables,
		},
	};
}

export async function ensureGitHubDeployAutomation(tenantRoot, { planOnly = false, valuesOverlay = {} } = {}) {
	const workflows = ensureStandardizedGitHubWorkflows(tenantRoot);
	const environment = await ensureGitHubEnvironment(tenantRoot, { planOnly, valuesOverlay });
	return {
		mode: getGitHubAutomationMode(),
		workflow: workflows[0],
		workflows,
		secrets: environment.secrets,
		variables: environment.variables,
		environment,
	};
}

export async function waitForGitHubWorkflowCompletion(
	tenantRoot,
	{
		repository,
		workflow = 'publish.yml',
		headSha,
		branch,
		timeoutSeconds = 600,
		pollSeconds = 5,
		dispatchIfMissing = false,
		dispatchAfterSeconds,
		dispatchInputs,
		onProgress,
		env,
	} = {},
) {
	const repo = repository ?? resolveGitHubRepositorySlug(tenantRoot);
	return await waitForGitHubWorkflowRunCompletion(repo, {
		client: createGitHubApiClient({ env }),
		workflow,
		headSha,
		branch,
		timeoutSeconds,
		pollSeconds,
		dispatchIfMissing,
		dispatchAfterSeconds,
		dispatchInputs,
		onProgress,
	});
}
