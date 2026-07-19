export const CAPACITY_PROVIDER_ENV_KEYS = [
	'TREESEED_CAPACITY_PROVIDER_MANIFEST',
	'TREESEED_PROVIDER_HOST_DATA_DIR',
	'TREESEED_PROVIDER_DATA_DIR',
	'TREESEED_PROVIDER_ENVIRONMENT',
	'TREESEED_PROVIDER_CAPABILITIES_FILE',
	'TREESEED_PROVIDER_BUDGET_FILE',
	'TREESEED_PROVIDER_MAX_CONCURRENT_WORKDAYS',
	'TREESEED_PROVIDER_MAX_CONCURRENT_RUNNERS',
	'TREESEED_PROVIDER_DAILY_CREDIT_BUDGET',
	'TREESEED_PROVIDER_MONTHLY_CREDIT_BUDGET',
	'TREESEED_CODEX_AUTH_FILE',
	'TREESEED_CODEX_AUTH_JSON_B64',
	'TREESEED_TREEDX_BASE_URL',
	'TREESEED_TREEDX_URL',
	'TREESEED_TREEDX_TOKEN',
] as const;

export function redactCapacityProviderSecret(value: string) {
	if (!value) return '';
	return value.length <= 8 ? '<redacted>' : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function isCapacityProviderSecretEnvKey(key: string) {
	return /(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY|AUTH_JSON)/u.test(key);
}

export function redactCapacityProviderEnv(env: Record<string, string>) {
	return Object.fromEntries(Object.entries(env).map(([key, value]) => [
		key,
		isCapacityProviderSecretEnvKey(key) ? redactCapacityProviderSecret(value) : value,
	]));
}
