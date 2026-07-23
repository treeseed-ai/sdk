import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTreeseedMachineEnvironmentValues } from '../../../src/operations/services/config-runtime.ts';
import { ensureTreeseedSceneVisualAuditRoleFixtures } from '../../../src/scenes/visual-audit-fixtures.ts';

vi.mock('../../../src/operations/services/config-runtime.ts', () => ({
	resolveTreeseedMachineEnvironmentValues: vi.fn(),
}));

const servers: Server[] = [];
const serviceEnvKeys = [
	'TREESEED_ACCEPTANCE_SERVICE_SECRET',
	'TREESEED_ACCEPTANCE_SERVICE_ID',
	'TREESEED_API_WEB_SERVICE_SECRET',
	'TREESEED_WEB_SERVICE_SECRET',
	'TREESEED_API_WEB_SERVICE_ID',
	'TREESEED_WEB_SERVICE_ID',
] as const;
const originalServiceEnv = new Map(serviceEnvKeys.map((key) => [key, process.env[key]]));

function clearServiceEnv() {
	for (const key of serviceEnvKeys) delete process.env[key];
}

function restoreServiceEnv() {
	for (const key of serviceEnvKeys) {
		const value = originalServiceEnv.get(key);
		if (typeof value === 'string') process.env[key] = value;
		else delete process.env[key];
	}
}

beforeEach(() => {
	clearServiceEnv();
});

afterEach(async () => {
	vi.restoreAllMocks();
	restoreServiceEnv();
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))));
});

async function listen(handler: Parameters<typeof createServer>[0]) {
	const server = createServer(handler);
	servers.push(server);
	return new Promise<string>((resolvePromise) => {
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') throw new Error('bad address');
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

describe('scene visual audit fixture config fallbacks', () => {
	it('uses env service identity, machine-config secrets, and skips unknown roles', async () => {
		process.env.TREESEED_WEB_SERVICE_ID = ' env-web ';
		vi.mocked(resolveTreeseedMachineEnvironmentValues).mockReturnValue({
			TREESEED_WEB_SERVICE_SECRET: ' machine-secret ',
		} as never);
		const requests: Array<{ url: string; serviceId?: string; secret?: string; actorKeys: string[] }> = [];
		const baseUrl = await listen(async (request, response) => {
			const body = await readBody(request);
			const parsed = body ? JSON.parse(body) : {};
			requests.push({
				url: request.url ?? '/',
				serviceId: request.headers['x-treeseed-service-id'] as string | undefined,
				secret: request.headers['x-treeseed-service-secret'] as string | undefined,
				actorKeys: Object.keys(parsed.actors ?? {}),
			});
			response.setHeader('content-type', 'application/json');
			if (request.url === '/v1/acceptance/seed') {
				response.end(JSON.stringify({ ok: true }));
				return;
			}
			if (request.url === '/v1/auth/web/sign-in') {
				response.end(JSON.stringify({ ok: true, payload: { accessToken: 'token' } }));
				return;
			}
			response.statusCode = 404;
			response.end(JSON.stringify({ ok: false }));
		});

		expect(await ensureTreeseedSceneVisualAuditRoleFixtures({
			baseUrl,
			roles: ['custom-role', 'owner'],
			projectRoot: process.cwd(),
			environment: 'staging',
		})).toEqual([]);
		expect(requests.find((entry) => entry.url === '/v1/acceptance/seed')).toMatchObject({
			serviceId: 'env-web',
			secret: 'machine-secret',
			actorKeys: ['owner'],
		});
		expect(resolveTreeseedMachineEnvironmentValues).toHaveBeenCalledWith(process.cwd(), 'staging');
	});

	it('uses the local development service secret when no configured secret exists', async () => {
		vi.mocked(resolveTreeseedMachineEnvironmentValues).mockReturnValue({} as never);
		let secret: string | undefined;
		const baseUrl = await listen(async (request, response) => {
			await readBody(request);
			if (request.url === '/v1/acceptance/seed') secret = request.headers['x-treeseed-service-secret'] as string | undefined;
			response.setHeader('content-type', 'application/json');
			if (request.url === '/v1/acceptance/seed' || request.url === '/v1/auth/web/sign-in') {
				response.end(JSON.stringify({ ok: true, payload: { accessToken: 'token' } }));
				return;
			}
			response.statusCode = 404;
			response.end(JSON.stringify({ ok: false }));
		});

		expect(await ensureTreeseedSceneVisualAuditRoleFixtures({ baseUrl, roles: ['admin'], projectRoot: process.cwd(), environment: 'local' })).toEqual([]);
		expect(secret).toBe('treeseed-web-service-dev-secret');
	});
});
