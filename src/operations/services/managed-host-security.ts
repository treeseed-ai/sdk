import type { TreeseedDeployConfig } from '../../platform/contracts.ts';

export const MANAGED_HOST_DIRECT_CI_OPT_IN_ENV = 'TREESEED_ALLOW_MANAGED_HOST_DIRECT_CI_SECRETS';

const SAFE_MANAGED_HOST_CI_VARIABLES = new Set([
	'TREESEED_CATALOG_MARKET_API_BASE_URLS',
	'TREESEED_CENTRAL_MARKET_API_BASE_URL',
	'TREESEED_HOSTING_KIND',
	'TREESEED_HOSTING_REGISTRATION',
	'TREESEED_HOSTING_TEAM_ID',
	'TREESEED_API_BASE_URL',
	'TREESEED_PROJECT_ID',
]);

const SAFE_MANAGED_HOST_CI_SECRETS = new Set([
	'TREESEED_TURNSTILE_SECRET_KEY',
]);

const MANAGED_HOST_FORBIDDEN_VARIABLE_PREFIXES = [
	'CLOUDFLARE_',
	'RAILWAY_',
	'TREESEED_API_',
	'TREESEED_AUTH_',
	'TREESEED_CLOUDFLARE_',
	'TREESEED_RAILWAY_',
	'TREESEED_SMTP_',
	'TREESEED_TURNSTILE_',
	'TREESEED_WEB_',
];

export function allowsManagedHostDirectCiSecrets(env: Record<string, string | undefined> = process.env) {
	const value = env[MANAGED_HOST_DIRECT_CI_OPT_IN_ENV];
	return value === '1' || value === 'true' || value === 'yes';
}

export function isTreeseedManagedHostedProject(deployConfig: Pick<TreeseedDeployConfig, 'hosting' | 'hub' | 'runtime'> | null | undefined) {
	return deployConfig?.hosting?.kind === 'hosted_project'
		&& deployConfig?.hub?.mode === 'treeseed_hosted'
		&& deployConfig?.runtime?.mode === 'treeseed_managed';
}

export function usesManagedHostOperationRequests(
	deployConfig: Pick<TreeseedDeployConfig, 'hosting' | 'hub' | 'runtime'> | null | undefined,
	env: Record<string, string | undefined> = process.env,
) {
	return isTreeseedManagedHostedProject(deployConfig) && !allowsManagedHostDirectCiSecrets(env);
}

export function filterManagedHostGitHubEnvironment(required: { secrets: string[]; variables: string[] }) {
	return {
		secrets: required.secrets.filter((name) => SAFE_MANAGED_HOST_CI_SECRETS.has(name)),
		variables: required.variables.filter((name) => {
			if (SAFE_MANAGED_HOST_CI_VARIABLES.has(name)) {
				return true;
			}
			return !MANAGED_HOST_FORBIDDEN_VARIABLE_PREFIXES.some((prefix) => name.startsWith(prefix));
		}),
	};
}

export function shouldExposeManagedHostRuntimeSecret(
	deployConfig: Pick<TreeseedDeployConfig, 'hosting' | 'hub' | 'runtime'> | null | undefined,
	_secretName: string,
	env: Record<string, string | undefined> = process.env,
) {
	return !usesManagedHostOperationRequests(deployConfig, env);
}
