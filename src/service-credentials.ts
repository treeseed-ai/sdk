export const TREESEED_GITHUB_TOKEN_ENV = 'TREESEED_GITHUB_TOKEN';
export const TREESEED_GITHUB_COPILOT_TOKEN_ENV = 'TREESEED_GITHUB_COPILOT_TOKEN';
export const TREESEED_CLOUDFLARE_API_TOKEN_ENV = 'TREESEED_CLOUDFLARE_API_TOKEN';
export const TREESEED_CLOUDFLARE_ACCOUNT_ID_ENV = 'TREESEED_CLOUDFLARE_ACCOUNT_ID';
export const TREESEED_RAILWAY_API_TOKEN_ENV = 'TREESEED_RAILWAY_API_TOKEN';
export const TREESEED_DOCKERHUB_TOKEN_ENV = 'TREESEED_DOCKERHUB_TOKEN';
export const TREESEED_DOCKERHUB_USERNAME_ENV = 'TREESEED_DOCKERHUB_USERNAME';
export const TREESEED_CODEX_API_KEY_ENV = 'TREESEED_CODEX_API_KEY';

type EnvLike = Record<string, string | undefined>;

function configuredValue(env: EnvLike | undefined, key: string) {
	const value = env?.[key];
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function resolveTreeseedGitHubToken(env: EnvLike = process.env) {
	return configuredValue(env, TREESEED_GITHUB_TOKEN_ENV);
}

export function resolveTreeseedGitHubCopilotToken(env: EnvLike = process.env) {
	return configuredValue(env, TREESEED_GITHUB_COPILOT_TOKEN_ENV);
}

export function resolveTreeseedCloudflareApiToken(env: EnvLike = process.env) {
	return configuredValue(env, TREESEED_CLOUDFLARE_API_TOKEN_ENV) || configuredValue(env, 'CLOUDFLARE_API_TOKEN');
}

export function resolveTreeseedCloudflareAccountId(env: EnvLike = process.env) {
	return configuredValue(env, TREESEED_CLOUDFLARE_ACCOUNT_ID_ENV) || configuredValue(env, 'CLOUDFLARE_ACCOUNT_ID');
}

export function resolveTreeseedRailwayApiToken(env: EnvLike = process.env) {
	return configuredValue(env, TREESEED_RAILWAY_API_TOKEN_ENV) || configuredValue(env, 'RAILWAY_API_TOKEN');
}

export function resolveTreeseedDockerhubToken(env: EnvLike = process.env) {
	return configuredValue(env, TREESEED_DOCKERHUB_TOKEN_ENV) || configuredValue(env, 'DOCKERHUB_TOKEN');
}

export function resolveTreeseedDockerhubUsername(env: EnvLike = process.env) {
	return configuredValue(env, TREESEED_DOCKERHUB_USERNAME_ENV) || configuredValue(env, 'DOCKERHUB_USERNAME');
}

export function resolveTreeseedCodexApiKey(env: EnvLike = process.env) {
	return configuredValue(env, TREESEED_CODEX_API_KEY_ENV);
}

export function withGitHubServiceCredentialEnv<TEnv extends EnvLike>(env: TEnv): TEnv & { GH_TOKEN?: string; GITHUB_TOKEN?: string } {
	const token = resolveTreeseedGitHubToken(env);
	return token
		? { ...env, GH_TOKEN: token, GITHUB_TOKEN: token }
		: { ...env };
}

export function withCloudflareServiceCredentialEnv<TEnv extends EnvLike>(env: TEnv): TEnv & { CLOUDFLARE_API_TOKEN?: string; CLOUDFLARE_ACCOUNT_ID?: string } {
	const token = resolveTreeseedCloudflareApiToken(env);
	const accountId = resolveTreeseedCloudflareAccountId(env);
	return {
		...env,
		...(token ? { CLOUDFLARE_API_TOKEN: token } : {}),
		...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}),
	};
}

export function withRailwayServiceCredentialEnv<TEnv extends EnvLike>(env: TEnv): TEnv & { RAILWAY_API_TOKEN?: string } {
	const token = resolveTreeseedRailwayApiToken(env);
	return token ? { ...env, RAILWAY_API_TOKEN: token } : { ...env };
}

export function withDockerhubServiceCredentialEnv<TEnv extends EnvLike>(env: TEnv): TEnv & { DOCKERHUB_TOKEN?: string; DOCKERHUB_USERNAME?: string } {
	const token = resolveTreeseedDockerhubToken(env);
	const username = resolveTreeseedDockerhubUsername(env);
	return {
		...env,
		...(token ? { DOCKERHUB_TOKEN: token } : {}),
		...(username ? { DOCKERHUB_USERNAME: username } : {}),
	};
}

export function withCodexServiceCredentialEnv<TEnv extends EnvLike>(env: TEnv): TEnv & { CODEX_API_KEY?: string } {
	const token = resolveTreeseedCodexApiKey(env);
	return token ? { ...env, CODEX_API_KEY: token } : { ...env };
}

export function withTreeseedServiceCredentialEnv<TEnv extends EnvLike>(env: TEnv) {
	return withCodexServiceCredentialEnv(
		withDockerhubServiceCredentialEnv(
			withRailwayServiceCredentialEnv(
				withCloudflareServiceCredentialEnv(
					withGitHubServiceCredentialEnv(env),
				),
			),
		),
	);
}
