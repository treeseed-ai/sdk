import { resolveEnvironmentRegistry } from '../../../platform/configuration/environment.ts';
import { loadCliDeployConfig } from '../agents/runtime-tools.ts';
import {
filterManagedHostGitHubEnvironment,
usesManagedHostOperationRequests,
} from '../hosting/audit/managed-host-security.ts';
import {
createGitHubApiClient,
listGitHubRepositorySecretNames,
listGitHubRepositoryVariableNames,
} from '../repositories/github-api.ts';
import { ensureGitHubEnvironment } from './non-empty-values.ts';

export function requiredGitHubEnvironment(tenantRoot, { scope = 'prod', purpose = 'save', managedHostMode = 'auto' } = {}) {
	const deployConfig = loadCliDeployConfig(tenantRoot);
	const registry = resolveEnvironmentRegistry({ deployConfig });
	const relevant = registry.entries.filter(
		(entry) =>
			entry.scopes.includes(scope)
			&& entry.purposes.includes(purpose)
			&& (!entry.isRelevant || entry.isRelevant(registry.context, scope, purpose)),
	);

	const required = {
		secrets: [...new Set(relevant.filter((entry) => entry.targets.includes('github-secret')).map((entry) => entry.id))],
		variables: [...new Set(relevant.filter((entry) => entry.targets.includes('github-variable')).map((entry) => entry.id))],
	};
	const managedBoundary = managedHostMode === 'managed'
		|| (managedHostMode === 'auto' && usesManagedHostOperationRequests(deployConfig));
	return managedBoundary ? filterManagedHostGitHubEnvironment(required) : required;
}

export function requiredGitHubSecrets(tenantRoot) {
	return requiredGitHubEnvironment(tenantRoot).secrets;
}

export async function listGitHubSecretNames(repository, tenantRoot) {
	void tenantRoot;
	return await listGitHubRepositorySecretNames(repository, { client: createGitHubApiClient() });
}

export async function listGitHubVariableNames(repository, tenantRoot) {
	void tenantRoot;
	return await listGitHubRepositoryVariableNames(repository, { client: createGitHubApiClient() });
}

export function formatMissingSecretsReport(repository, missingSecrets, reason = 'missing_local_env') {
	const lines = [
		'Treeseed GitHub secret sync failed.',
		`Repository: ${repository}`,
		`Reason: ${reason}`,
		'Missing secrets:',
	];

	for (const secret of missingSecrets) {
		lines.push(`- ${secret.name}: localEnv=${secret.localEnvPresent ? 'present' : 'missing'} remote=${secret.remotePresent ? 'present' : 'missing'}`);
	}

	return lines.join('\n');
}

export async function ensureGitHubSecrets(tenantRoot, { planOnly = false } = {}) {
	return (await ensureGitHubEnvironment(tenantRoot, { planOnly })).secrets;
}
