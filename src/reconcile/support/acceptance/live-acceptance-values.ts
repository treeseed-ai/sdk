export type LiveAcceptanceEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

export function configuredLiveAcceptanceValue(env: LiveAcceptanceEnv, keys: string[]) {
	for (const key of keys) {
		const value = env[key];
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return '';
}
