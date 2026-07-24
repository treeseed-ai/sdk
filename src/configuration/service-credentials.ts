export const GITHUB_TOKEN_ENV = 'TREESEED_GITHUB_TOKEN';
export const GITHUB_COPILOT_TOKEN_ENV = 'TREESEED_GITHUB_COPILOT_TOKEN';
export const CLOUDFLARE_API_TOKEN_ENV = 'TREESEED_CLOUDFLARE_API_TOKEN';
export const CLOUDFLARE_ACCOUNT_ID_ENV = 'TREESEED_CLOUDFLARE_ACCOUNT_ID';
export const RAILWAY_API_TOKEN_ENV = 'TREESEED_RAILWAY_API_TOKEN';
export const RAILWAY_TOKEN_ENV = 'TREESEED_RAILWAY_TOKEN';
export const DOCKERHUB_TOKEN_ENV = 'TREESEED_DOCKERHUB_TOKEN';
export const DOCKERHUB_USERNAME_ENV = 'TREESEED_DOCKERHUB_USERNAME';
export const CODEX_API_KEY_ENV = 'TREESEED_CODEX_API_KEY';

type EnvLike = Record<string, string | undefined>;

function configuredValue(env: EnvLike | undefined, key: string) {
	const value = env?.[key];
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function resolveGitHubToken(env: EnvLike = process.env) {
	return configuredValue(env, GITHUB_TOKEN_ENV);
}

export function resolveGitHubCopilotToken(env: EnvLike = process.env) {
	return configuredValue(env, GITHUB_COPILOT_TOKEN_ENV);
}

export function resolveCloudflareApiToken(env: EnvLike = process.env) {
	return configuredValue(env, CLOUDFLARE_API_TOKEN_ENV);
}

export function resolveCloudflareAccountId(env: EnvLike = process.env) {
	return configuredValue(env, CLOUDFLARE_ACCOUNT_ID_ENV);
}

export function resolveRailwayCredential(env: EnvLike = process.env) {
	return configuredValue(env, RAILWAY_API_TOKEN_ENV);
}

export function resolveRailwayProjectToken(env: EnvLike = process.env) {
	return configuredValue(env, RAILWAY_TOKEN_ENV);
}

export function resolveDockerhubToken(env: EnvLike = process.env) {
	return configuredValue(env, DOCKERHUB_TOKEN_ENV);
}

export function resolveDockerhubUsername(env: EnvLike = process.env) {
	return configuredValue(env, DOCKERHUB_USERNAME_ENV);
}

export function resolveCodexApiKey(env: EnvLike = process.env) {
	return configuredValue(env, CODEX_API_KEY_ENV);
}

export function withGitHubServiceCredentialEnv<TEnv extends EnvLike>(env: TEnv): TEnv & { GH_TOKEN?: string; GITHUB_TOKEN?: string } {
	const token = resolveGitHubToken(env);
	return token
		? { ...env, GH_TOKEN: token, GITHUB_TOKEN: token }
		: { ...env };
}

export function withCloudflareServiceCredentialEnv<TEnv extends EnvLike>(env: TEnv): TEnv & { CLOUDFLARE_API_TOKEN?: string; CLOUDFLARE_ACCOUNT_ID?: string } {
	const token = resolveCloudflareApiToken(env);
	const accountId = resolveCloudflareAccountId(env);
	return {
		...env,
		...(token ? { CLOUDFLARE_API_TOKEN: token } : {}),
		...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}),
	};
}

export function withRailwayServiceCredentialEnv<TEnv extends EnvLike>(env: TEnv): TEnv & { RAILWAY_API_TOKEN?: string; RAILWAY_TOKEN?: string } {
	const token = resolveRailwayCredential(env);
	const projectToken = resolveRailwayProjectToken(env);
	return {
		...env,
		...(token ? { RAILWAY_API_TOKEN: token } : {}),
		...(projectToken ? { RAILWAY_TOKEN: projectToken } : {}),
	};
}

export function withDockerhubServiceCredentialEnv<TEnv extends EnvLike>(env: TEnv): TEnv & { DOCKERHUB_TOKEN?: string; DOCKERHUB_USERNAME?: string } {
	const token = resolveDockerhubToken(env);
	const username = resolveDockerhubUsername(env);
	return {
		...env,
		...(token ? { DOCKERHUB_TOKEN: token } : {}),
		...(username ? { DOCKERHUB_USERNAME: username } : {}),
	};
}

export function withCodexServiceCredentialEnv<TEnv extends EnvLike>(env: TEnv): TEnv & { CODEX_API_KEY?: string } {
	const token = resolveCodexApiKey(env);
	return token ? { ...env, CODEX_API_KEY: token } : { ...env };
}

export function withServiceCredentialEnv<TEnv extends EnvLike>(env: TEnv) {
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
