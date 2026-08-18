import { afterEach,describe,expect,it,vi } from 'vitest';
import { getContentServingMode } from '../../../src/platform/hosting/deploy-runtime.ts';
import { parseDeployConfig } from '../../../src/platform/deploy-config/parse-deploy-config.ts';

afterEach(() => vi.unstubAllEnvs());

function config(serving: 'local_collections' | 'published_runtime') {
	return parseDeployConfig(`
name: Example
slug: example
siteUrl: https://example.com
contactEmail: hello@example.com
providers:
  content:
    serving: ${serving}
`);
}

describe('content serving mode', () => {
	it('uses the explicitly loaded tenant config during build configuration', () => {
		expect(getContentServingMode(config('published_runtime'))).toBe('published_runtime');
		expect(getContentServingMode(config('local_collections'))).toBe('local_collections');
	});

	it('preserves the explicit process override for controlled verification', () => {
		vi.stubEnv('TREESEED_CONTENT_SERVING_MODE', 'local_collections');
		expect(getContentServingMode(config('published_runtime'))).toBe('local_collections');
	});
});
