import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configuredLiveAcceptanceValue as configuredValue, type LiveAcceptanceEnv } from './live-acceptance-values.ts';

function domainFromWorkspace(cwd: string) {
	try {
		const manifest = readFileSync(join(cwd, 'treeseed.site.yaml'), 'utf8');
		const match = /^siteUrl:\s*(\S+)/gmu.exec(manifest);
		if (!match?.[1]) return '';
		const url = new URL(match[1]);
		return url.hostname.replace(/^www\./iu, '');
	} catch {
		return '';
	}
}

export function resolveLiveTestDomain(cwd: string, env: LiveEnv) {
	return configuredValue(env, ['TREESEED_LIVE_TEST_DOMAIN'])
		|| configuredValue(env, ['TREESEED_DOMAIN'])
		|| domainFromWorkspace(cwd);
}

