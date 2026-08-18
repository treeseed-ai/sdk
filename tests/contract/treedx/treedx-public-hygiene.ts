import { expect } from 'vitest';

const blockedPatterns = [
	/"localPath"\s*:/,
	/"materializedPath"\s*:/,
	/\/var\/lib\/treedx/,
	/\/tmp\/treedx/i,
	/Bearer\s+[A-Za-z0-9._~+/=-]+/,
	/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
	/TREEDX_[A-Z0-9_]+/,
	/https?:\/\/[^"\s]*((token|secret|password|access_token)=)[^"\s]*/i,
	/docs\/private\/hidden\.md/,
	/repo_hidden/,
	/hidden repo secret/i,
];

export function assertPublicHygiene(payload: unknown): void {
	const json = JSON.stringify(payload);
	for (const pattern of blockedPatterns) {
		expect(json, `public response leaked ${pattern}`).not.toMatch(pattern);
	}
}
