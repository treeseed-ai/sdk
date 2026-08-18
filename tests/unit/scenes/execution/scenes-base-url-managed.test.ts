import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readDevInstance } from '../../../../src/local-dev/managed-dev.ts';
import { resolveSceneApiBaseUrl, resolveSceneBaseUrl } from '../../../../src/scenes/support/execution/base-url.ts';

vi.mock('../../../../src/local-dev/managed-dev.ts', () => ({
	readDevInstance: vi.fn(),
}));

function scene(baseUrl = 'auto') {
	return {
		schemaVersion: 'treeseed.scene/v1',
		id: 'managed-base-url',
		title: 'Managed Base URL',
		target: { baseUrl },
		workflow: [],
	} as never;
}

describe('scene managed base URL resolution', () => {
	it('resolves managed local web and API health URLs with host normalization', () => {
		vi.mocked(readDevInstance).mockImplementation(({ surface }) => surface === 'web'
			? { running: true, health: [{ kind: 'tcp', url: 'tcp://ignored' }, { kind: 'http', url: 'http://0.0.0.0:4321/healthz' }] } as never
			: { running: true, health: [{ kind: 'http', url: 'http://0.0.0.0:3000/health' }] } as never);

		expect(resolveSceneBaseUrl({ projectRoot: process.cwd(), scene: scene(), environment: 'local' })).toMatchObject({
			ok: true,
			baseUrl: 'http://0.0.0.0:4321/healthz',
		});
		expect(resolveSceneApiBaseUrl({ projectRoot: process.cwd(), environment: 'local', webBaseUrl: 'http://web.test' })).toBe('http://127.0.0.1:3000');
	});

	it('falls back when managed instances are missing or expose non-URL health strings', () => {
		vi.mocked(readDevInstance).mockImplementation(({ surface }) => surface === 'web'
			? { running: true, health: [] } as never
			: { running: true, health: [{ kind: 'http', url: 'api.local/healthz' }] } as never);

		const web = resolveSceneBaseUrl({ projectRoot: process.cwd(), scene: scene(), environment: 'local' });
		expect(web.ok).toBe(false);
		expect(web.diagnostics.map((entry) => entry.code)).toContain('scene.local_dev_not_running');
		expect(resolveSceneApiBaseUrl({ projectRoot: process.cwd(), environment: 'local', webBaseUrl: 'http://web.test' })).toBe('api.local');

		vi.mocked(readDevInstance).mockReturnValue({ running: false, health: [{ kind: 'http', url: 'http://127.0.0.1:4321' }] } as never);
		expect(resolveSceneBaseUrl({ projectRoot: process.cwd(), scene: scene(), environment: 'local' }).ok).toBe(false);
	});

	it('resolves hosted web and API URLs from configured service, surface, connection, and domain records', () => {
		const root = mkdtempSync(resolve(tmpdir(), 'treeseed-sdk-hosted-url-'));
		writeFileSync(resolve(root, 'treeseed.site.yaml'), `schemaVersion: treeseed.site/v1
name: Hosted URL Test
slug: hosted-url-test
siteUrl: https://hosted-url.example.test
contactEmail: ops@example.test
services:
  web:
    environments:
      staging:
        baseUrl: " https://web-service.example.test/app/ "
  api:
    environments:
      prod:
        domain: https://api-service-prod.example.test
surfaces:
  web:
    publicBaseUrl: https://web-public.example.test
    environments:
      prod:
        domain: prod-web.example.test
  api:
    publicBaseUrl: https://api-public.example.test
    environments:
      staging:
        domain: staging-api.example.test
connections:
  api:
    environments:
      staging:
        domain: api-connection.example.test
`);
		expect(resolveSceneBaseUrl({ projectRoot: root, scene: scene(), environment: 'staging' })).toMatchObject({
			ok: true,
			baseUrl: 'https://web-service.example.test/app/',
		});
		expect(resolveSceneBaseUrl({ projectRoot: root, scene: scene(), environment: 'prod' })).toMatchObject({
			ok: true,
			baseUrl: 'https://prod-web.example.test',
		});
		expect(resolveSceneApiBaseUrl({ projectRoot: root, environment: 'staging', webBaseUrl: 'https://web.example.test' })).toBe('https://api-connection.example.test');
		expect(resolveSceneApiBaseUrl({ projectRoot: root, environment: 'prod', webBaseUrl: 'https://web.example.test' })).toBe('https://api-service-prod.example.test');
	});

	it('falls through malformed hosted config, package API config, env API fallback, and empty domain records', () => {
		const malformedRoot = mkdtempSync(resolve(tmpdir(), 'treeseed-sdk-malformed-url-'));
		writeFileSync(resolve(malformedRoot, 'treeseed.site.yaml'), 'schemaVersion: [');
		expect(resolveSceneBaseUrl({ projectRoot: malformedRoot, scene: scene(), environment: 'staging' })).toMatchObject({
			ok: true,
			baseUrl: 'https://preview.treeseed.dev',
		});

		const apiRoot = mkdtempSync(resolve(tmpdir(), 'treeseed-sdk-package-api-url-'));
		mkdirSync(resolve(apiRoot, 'packages/api'), { recursive: true });
		writeFileSync(resolve(apiRoot, 'packages/api/treeseed.site.yaml'), `schemaVersion: treeseed.site/v1
name: Package API URL Test
slug: package-api-url-test
siteUrl: https://package-api.example.test
contactEmail: ops@example.test
connections:
  api:
    environments:
      staging: {}
services:
  api:
    environments:
      staging:
        domain: ""
surfaces:
  api:
    environments:
      staging:
        baseUrl: https://surface-api.example.test
      prod:
        domain: prod-surface-api.example.test
`);
		expect(resolveSceneApiBaseUrl({ projectRoot: apiRoot, environment: 'staging', webBaseUrl: 'https://web.example.test' })).toBe('https://surface-api.example.test');
		expect(resolveSceneApiBaseUrl({ projectRoot: apiRoot, environment: 'prod', webBaseUrl: 'https://web.example.test' })).toBe('https://prod-surface-api.example.test');

		vi.mocked(readDevInstance).mockReturnValue(null);
		process.env.TREESEED_API_BASE_URL = '   ';
		process.env.TREESEED_MARKET_API_BASE_URL = ' http://127.0.0.1:3999/api/ ';
		expect(resolveSceneApiBaseUrl({ projectRoot: apiRoot, environment: 'local', webBaseUrl: 'http://web.test' })).toBe('http://127.0.0.1:3999/api');
		delete process.env.TREESEED_API_BASE_URL;
		delete process.env.TREESEED_MARKET_API_BASE_URL;
	});
});
