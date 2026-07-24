import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveSceneApiBaseUrl, resolveSceneBaseUrl } from '../../../src/scenes/support/execution/base-url.ts';
import {
	ensureSceneVisualAuditRoleFixtures,
	signInSceneVisualAuditRole,
	VISUAL_AUDIT_PASSWORD,
	SceneVisualAuditUserForRole,
	validateSceneVisualAuditRoles,
} from '../../../src/scenes/testing/visual-audit-fixtures.ts';

const servers: Server[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	delete process.env.TREESEED_API_BASE_URL;
	delete process.env.TREESEED_MARKET_API_BASE_URL;
	delete process.env.TREESEED_API_WEB_SERVICE_SECRET;
	delete process.env.TREESEED_WEB_SERVICE_SECRET;
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))));
});

function scene(baseUrl: string = 'auto') {
	return {
		schemaVersion: 'treeseed.scene/v1',
		id: 'base-url-scene',
		title: 'Base URL Scene',
		target: { baseUrl },
		workflow: [],
	} as never;
}

async function listen(handler: Parameters<typeof createServer>[0]) {
	const server = createServer(handler);
	servers.push(server);
	return new Promise<string>((resolvePromise) => {
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') throw new Error('Unexpected test server address.');
			resolvePromise(`http://127.0.0.1:${address.port}`);
		});
	});
}

function readBody(request: import('node:http').IncomingMessage) {
	return new Promise<string>((resolvePromise) => {
		let body = '';
		request.on('data', (chunk) => {
			body += String(chunk);
		});
		request.on('end', () => resolvePromise(body));
	});
}

describe('scene base URL resolution critical coverage', () => {
	it('resolves explicit, environment report, hosted default, hosted config, and unresolved local base URLs', () => {
		const root = mkdtempSync(resolve(tmpdir(), 'treeseed-sdk-base-url-'));
		expect(resolveSceneBaseUrl({ projectRoot: root, scene: scene('http://example.test'), environment: 'local' })).toMatchObject({ ok: true, baseUrl: 'http://example.test' });
		expect(resolveSceneBaseUrl({ projectRoot: root, scene: scene(), environment: 'local', environmentReport: { ok: true, phase: 3, dev: { baseUrl: 'http://127.0.0.1:4321' }, diagnostics: [] } as never })).toMatchObject({ ok: true, baseUrl: 'http://127.0.0.1:4321' });
		expect(resolveSceneBaseUrl({ projectRoot: root, scene: scene(), environment: 'staging' })).toMatchObject({ ok: true, baseUrl: 'https://preview.treeseed.dev' });
		expect(resolveSceneBaseUrl({ projectRoot: root, scene: scene(), environment: 'prod' })).toMatchObject({ ok: true, baseUrl: 'https://treeseed.dev' });

		writeFileSync(resolve(root, 'treeseed.site.yaml'), `name: Test Site
slug: test-site
surfaces:
  web:
    enabled: true
    provider: cloudflare
    publicBaseUrl: https://public.example.test
    environments:
      staging:
        domain: staging.example.test
      prod:
        domain: prod.example.test
services:
  web:
    enabled: true
    environments:
      prod:
        baseUrl: https://prod-service.example.test
connections:
  api:
    environments:
      staging:
        domain: api-staging.example.test
`);
		expect(resolveSceneBaseUrl({ projectRoot: root, scene: scene(), environment: 'staging' })).toMatchObject({ baseUrl: 'https://preview.treeseed.dev' });
		expect(resolveSceneBaseUrl({ projectRoot: root, scene: scene(), environment: 'prod' })).toMatchObject({ baseUrl: 'https://treeseed.dev' });

		const local = resolveSceneBaseUrl({ projectRoot: root, scene: scene(), environment: 'local' });
		expect(local.ok).toBe(false);
		expect(local.diagnostics[0]?.code).toBe('scene.local_dev_not_running');
	});

	it('resolves API base URLs from env, hosted config, managed defaults, and web fallback', () => {
		const root = mkdtempSync(resolve(tmpdir(), 'treeseed-sdk-api-url-'));
		process.env.TREESEED_API_BASE_URL = 'http://127.0.0.1:3000/';
		expect(resolveSceneApiBaseUrl({ projectRoot: root, environment: 'local', webBaseUrl: 'http://127.0.0.1:4321' })).toBe('http://127.0.0.1:3000');
		delete process.env.TREESEED_API_BASE_URL;
		process.env.TREESEED_MARKET_API_BASE_URL = 'http://127.0.0.1:3001/';
		expect(resolveSceneApiBaseUrl({ projectRoot: root, environment: 'local', webBaseUrl: 'http://127.0.0.1:4321' })).toMatch(/^http:\/\/127\.0\.0\.1:300[01]$/u);
		delete process.env.TREESEED_MARKET_API_BASE_URL;
		expect(resolveSceneApiBaseUrl({ projectRoot: root, environment: 'local', webBaseUrl: 'http://127.0.0.1:4321' })).toMatch(/^http:\/\/127\.0\.0\.1:(3000|4321)$/u);
		expect(resolveSceneApiBaseUrl({ projectRoot: root, environment: 'unknown', webBaseUrl: 'https://web.example.test' })).toBe('https://web.example.test');
		expect(resolveSceneApiBaseUrl({ projectRoot: root, environment: 'staging', webBaseUrl: 'https://web.example.test' })).toBe('https://api.preview.treeseed.dev');
		expect(resolveSceneApiBaseUrl({ projectRoot: root, environment: 'prod', webBaseUrl: 'https://web.example.test' })).toBe('https://api.treeseed.dev');

		mkdirSync(resolve(root, 'packages/api'), { recursive: true });
		writeFileSync(resolve(root, 'packages/api/treeseed.site.yaml'), `schemaVersion: treeseed.site/v1
services:
  api:
    environments:
      staging:
        baseUrl: https://api-service.example.test
surfaces:
  api:
    environments:
      prod:
        domain: prod-api.example.test
`);
		expect(['https://api-service.example.test', 'https://api.preview.treeseed.dev']).toContain(resolveSceneApiBaseUrl({ projectRoot: root, environment: 'staging', webBaseUrl: 'https://web.example.test' }));
		expect(['https://prod-api.example.test', 'https://api.treeseed.dev']).toContain(resolveSceneApiBaseUrl({ projectRoot: root, environment: 'prod', webBaseUrl: 'https://web.example.test' }));
	});
});

describe('scene visual audit fixture critical coverage', () => {
	it('validates built-in roles and unknown role diagnostics', () => {
		expect(SceneVisualAuditUserForRole('owner')).toMatchObject({ email: 'visual.owner@treeseed.io', password: VISUAL_AUDIT_PASSWORD });
		expect(SceneVisualAuditUserForRole('anonymous')).toBeNull();
		expect(validateSceneVisualAuditRoles(['anonymous', 'owner', 'custom-role' as never]).map((entry) => entry.code)).toEqual(['scene.visual_audit_role_unknown']);
	});

	it('seeds and signs in visual audit fixtures through local API responses', async () => {
		const requests: Array<{ url: string; body: string }> = [];
		const baseUrl = await listen(async (request, response) => {
			const body = await readBody(request);
			requests.push({ url: request.url ?? '/', body });
			response.setHeader('content-type', 'application/json');
			if (request.url === '/v1/acceptance/seed') {
				response.end(JSON.stringify({ ok: true }));
				return;
			}
			if (request.url === '/v1/auth/web/sign-in') {
				response.end(JSON.stringify({ ok: true, payload: { accessToken: 'token', expiresInSeconds: 60 } }));
				return;
			}
			response.statusCode = 404;
			response.end(JSON.stringify({ ok: false }));
		});
		const diagnostics = await ensureSceneVisualAuditRoleFixtures({ baseUrl, roles: ['owner', 'owner', 'anonymous'], environment: 'local' });
		expect(diagnostics).toEqual([]);
		expect(requests.some((entry) => entry.url === '/v1/acceptance/seed')).toBe(true);

		const cookies: unknown[] = [];
		const page = {
			context: () => ({ addCookies: async (entries: unknown[]) => cookies.push(...entries) }),
			goto: vi.fn(async () => ({ status: () => 200, url: () => `${baseUrl}/app/` })),
			waitForLoadState: vi.fn(async () => undefined),
			url: () => `${baseUrl}/app/`,
		};
		expect(await signInSceneVisualAuditRole({ page, baseUrl, role: 'owner' })).toEqual([]);
		expect(cookies).toHaveLength(1);
	});

	it('reports seed, signup confirmation, unknown role, and browser form login failures', async () => {
		const failedSeedBaseUrl = await listen(async (_request, response) => {
			response.statusCode = 503;
			response.end('unavailable');
		});
		const seedDiagnostics = await ensureSceneVisualAuditRoleFixtures({ baseUrl: failedSeedBaseUrl, roles: ['owner'], environment: 'local' });
		expect(seedDiagnostics.some((entry) => entry.code === 'scene.visual_audit_fixture_unavailable')).toBe(true);

		const confirmationBaseUrl = await listen(async (request, response) => {
			response.setHeader('content-type', 'application/json');
			if (request.url === '/v1/acceptance/seed') {
				response.end(JSON.stringify({ ok: true }));
				return;
			}
			if (request.url === '/v1/auth/web/sign-in') {
				response.statusCode = 400;
				response.end(JSON.stringify({ ok: false }));
				return;
			}
			if (request.url === '/v1/auth/web/sign-up') {
				response.end(JSON.stringify({ ok: true, payload: { confirmationRequired: true } }));
				return;
			}
			response.statusCode = 404;
			response.end(JSON.stringify({ ok: false }));
		});
		const confirmationDiagnostics = await ensureSceneVisualAuditRoleFixtures({ baseUrl: confirmationBaseUrl, roles: ['owner'], environment: 'local' });
		expect(confirmationDiagnostics.some((entry) => entry.message.includes('requires email confirmation'))).toBe(true);

		expect((await signInSceneVisualAuditRole({ page: {}, baseUrl: confirmationBaseUrl, role: 'custom' as never })).map((entry) => entry.code)).toEqual(['scene.visual_audit_role_unknown']);

		const locator = {
			first: () => locator,
			fill: vi.fn(async () => undefined),
		};
		const page = {
			context: () => ({ addCookies: async () => undefined }),
			goto: vi.fn(async () => ({ status: () => 200, url: () => `${confirmationBaseUrl}/auth/sign-in` })),
			waitForLoadState: vi.fn(async () => undefined),
			waitForURL: vi.fn(async () => undefined),
			locator: vi.fn(() => locator),
			getByRole: vi.fn(() => ({ click: vi.fn(async () => undefined) })),
			url: () => `${confirmationBaseUrl}/auth/sign-in`,
		};
		const loginDiagnostics = await signInSceneVisualAuditRole({ page, baseUrl: confirmationBaseUrl, role: 'owner' });
		expect(loginDiagnostics[0]?.code).toBe('scene.visual_audit_role_login_failed');
	}, 15_000);

	it('handles anonymous-only fixtures, confirmation tokens, API sign-in base URLs, and form login success', async () => {
		const anonymousBaseUrl = await listen(async (_request, response) => {
			response.statusCode = 500;
			response.end('should not be called');
		});
		expect(await ensureSceneVisualAuditRoleFixtures({ baseUrl: anonymousBaseUrl, roles: ['anonymous'], environment: 'local' })).toEqual([]);

		const requests: Array<{ url: string; body: string }> = [];
		const setupBaseUrl = await listen(async (request, response) => {
			const body = await readBody(request);
			requests.push({ url: request.url ?? '/', body });
			response.setHeader('content-type', 'application/json');
			if (request.url === '/v1/acceptance/seed') {
				response.end(JSON.stringify({ ok: true }));
				return;
			}
			if (request.url === '/v1/auth/web/sign-in') {
				response.statusCode = 400;
				response.end(JSON.stringify({ ok: false }));
				return;
			}
			if (request.url === '/v1/auth/web/sign-up') {
				response.end(JSON.stringify({ ok: true, payload: { confirmationToken: 'confirm-token' } }));
				return;
			}
			if (request.url === '/v1/auth/web/confirm-email') {
				response.end(JSON.stringify({ ok: true }));
				return;
			}
			response.statusCode = 404;
			response.end(JSON.stringify({ ok: false }));
		});
		expect(await ensureSceneVisualAuditRoleFixtures({ baseUrl: setupBaseUrl, roles: ['admin'], environment: 'local' })).toEqual([]);
		expect(requests.some((entry) => entry.url === '/v1/auth/web/confirm-email' && entry.body.includes('confirm-token'))).toBe(true);

		const apiBaseUrl = await listen(async (request, response) => {
			response.setHeader('content-type', 'application/json');
			if (request.url === '/v1/auth/web/sign-in') {
				response.end(JSON.stringify({ ok: true, payload: { accessToken: 'api-token', expiresInSeconds: 120 } }));
				return;
			}
			response.statusCode = 404;
			response.end(JSON.stringify({ ok: false }));
		});
		const cookies: unknown[] = [];
		const apiPage = {
			context: () => ({ addCookies: async (entries: unknown[]) => cookies.push(...entries) }),
			goto: vi.fn(async () => ({ status: () => 200, url: () => `${setupBaseUrl}/app/` })),
			waitForLoadState: vi.fn(async () => undefined),
			url: () => `${setupBaseUrl}/app/`,
		};
		expect(await signInSceneVisualAuditRole({ page: apiPage, baseUrl: setupBaseUrl, apiBaseUrl, role: 'admin' })).toEqual([]);
		expect(cookies).toHaveLength(1);

		const locator = {
			first: () => locator,
			fill: vi.fn(async () => undefined),
		};
		let currentUrl = `${setupBaseUrl}/auth/sign-in`;
		const formPage = {
			context: () => ({ addCookies: async () => undefined }),
			goto: vi.fn(async (url: string) => {
				currentUrl = url;
				return { status: () => 200, url: () => url };
			}),
			waitForLoadState: vi.fn(async () => undefined),
			waitForURL: vi.fn(async () => {
				currentUrl = `${setupBaseUrl}/app/`;
			}),
			locator: vi.fn(() => locator),
			getByRole: vi.fn(() => ({ click: vi.fn(async () => {
				currentUrl = `${setupBaseUrl}/app/`;
			}) })),
			url: () => currentUrl,
		};
		expect(await signInSceneVisualAuditRole({ page: formPage, baseUrl: setupBaseUrl, apiBaseUrl: `${setupBaseUrl}/missing-api`, role: 'member' })).toEqual([]);
	});

	it('covers visual-audit retry, service-header, no-token, and already-signed-in branches', async () => {
		process.env.TREESEED_API_WEB_SERVICE_SECRET = ' api-secret ';
		const requests: Array<{ url: string; auth?: string; service?: string; teamRole?: string }> = [];
		let seedAttempts = 0;
		const baseUrl = await listen(async (request, response) => {
			const body = await readBody(request);
			const parsed = body ? JSON.parse(body) : {};
			requests.push({
				url: request.url ?? '/',
				auth: request.headers.authorization,
				service: request.headers['x-treeseed-service-secret'] as string | undefined,
				teamRole: parsed?.actors?.member?.teamRole,
			});
			response.setHeader('content-type', 'application/json');
			if (request.url === '/v1/acceptance/seed') {
				seedAttempts += 1;
				if (seedAttempts === 1) {
					response.statusCode = 503;
					response.end(JSON.stringify({ ok: false }));
					return;
				}
				response.end(JSON.stringify({ ok: true }));
				return;
			}
			if (request.url === '/v1/auth/web/sign-in') {
				response.end(JSON.stringify({ ok: true, payload: { accessToken: 'retry-token' } }));
				return;
			}
			response.statusCode = 404;
			response.end(JSON.stringify({ ok: false }));
		});
		const diagnostics = await ensureSceneVisualAuditRoleFixtures({
			baseUrl,
			roles: ['member'],
			environment: 'staging',
		});
		expect(diagnostics).toEqual([]);
		expect(seedAttempts).toBe(2);
		expect(requests.some((entry) => entry.service === 'api-secret')).toBe(true);
		expect(requests.some((entry) => entry.teamRole === 'contributor')).toBe(true);

		let currentUrl = `${baseUrl}/app/projects`;
		const alreadySignedInPage = {
			context: () => ({ addCookies: async () => undefined }),
			goto: vi.fn(async (url: string) => {
				currentUrl = url;
				return { status: () => 200, url: () => url };
			}),
			waitForLoadState: vi.fn(async () => undefined),
			url: () => currentUrl,
		};
		expect(await signInSceneVisualAuditRole({ page: alreadySignedInPage, baseUrl, role: 'owner' })).toEqual([]);

		const noTokenApiBaseUrl = await listen(async (request, response) => {
			response.setHeader('content-type', 'application/json');
			if (request.url === '/v1/auth/web/sign-in') {
				response.end(JSON.stringify({ ok: true, payload: {} }));
				return;
			}
			response.statusCode = 404;
			response.end(JSON.stringify({ ok: false }));
		});
		const noTokenPage = {
			context: () => ({ addCookies: async () => undefined }),
			goto: vi.fn(async (url: string) => {
				currentUrl = url;
				return { status: () => 200, url: () => url };
			}),
			waitForLoadState: vi.fn(async () => undefined),
			waitForURL: vi.fn(async () => {
				currentUrl = `${baseUrl}/app/`;
			}),
			locator: vi.fn(() => ({ first: () => ({ fill: vi.fn(async () => undefined) }) })),
			getByRole: vi.fn(() => ({ click: vi.fn(async () => {
				currentUrl = `${baseUrl}/app/`;
			}) })),
			url: () => currentUrl,
		};
		currentUrl = `${baseUrl}/auth/sign-in`;
		expect(await signInSceneVisualAuditRole({ page: noTokenPage, baseUrl, apiBaseUrl: noTokenApiBaseUrl, role: 'admin' })).toEqual([]);
	});

	it('recovers fixture setup when signup fails but the seeded user can sign in afterward', async () => {
		let signInAttempts = 0;
		let signupAttempts = 0;
		const baseUrl = await listen(async (request, response) => {
			await readBody(request);
			response.setHeader('content-type', 'application/json');
			if (request.url === '/v1/acceptance/seed') {
				response.end(JSON.stringify({ ok: true }));
				return;
			}
			if (request.url === '/v1/auth/web/sign-in') {
				signInAttempts += 1;
				if (signInAttempts === 1) {
					response.statusCode = 409;
					response.end(JSON.stringify({ ok: false }));
					return;
				}
				response.end(JSON.stringify({ ok: true, payload: { accessToken: 'existing-token' } }));
				return;
			}
			if (request.url === '/v1/auth/web/sign-up') {
				signupAttempts += 1;
				response.statusCode = 503;
				response.end(JSON.stringify({ ok: false }));
				return;
			}
			response.statusCode = 404;
			response.end(JSON.stringify({ ok: false }));
		});

		expect(await ensureSceneVisualAuditRoleFixtures({ baseUrl, roles: ['owner'], environment: 'local' })).toEqual([]);
		expect(signInAttempts).toBe(2);
		expect(signupAttempts).toBe(1);
	});

	it('reports non-Error fixture and browser failures after bounded retries', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('fetch', vi.fn(async () => Promise.reject('fixture network unavailable')));
		const fixturePromise = ensureSceneVisualAuditRoleFixtures({
			baseUrl: 'http://fixture-unavailable.test',
			roles: ['owner'],
			environment: 'local',
		});
		await vi.runAllTimersAsync();
		const fixtureDiagnostics = await fixturePromise;
		expect(fixtureDiagnostics.some((entry) => entry.message.includes('fixture network unavailable'))).toBe(true);

		const page = {
			context: () => ({ addCookies: async () => undefined }),
			goto: async () => Promise.reject('browser form unavailable'),
			waitForLoadState: async () => undefined,
			url: () => 'http://fixture-unavailable.test/auth/sign-in',
		};
		const loginPromise = signInSceneVisualAuditRole({
			page,
			baseUrl: 'http://fixture-unavailable.test',
			role: 'owner',
		});
		await vi.runAllTimersAsync();
		const loginDiagnostics = await loginPromise;
		expect(loginDiagnostics[0]?.message).toContain('browser form unavailable');
	});
});
