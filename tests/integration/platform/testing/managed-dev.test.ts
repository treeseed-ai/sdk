import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIntegratedDevPlan, startManagedDev, stopManagedDev } from '../../../../src/local-dev/managed-dev.ts';
import { managedDevPackageInstallRequired } from '../../../../src/local-dev/source-closure.ts';

vi.mock('node:child_process', async (importOriginal) => ({
	...await importOriginal<typeof import('node:child_process')>(),
	spawn: vi.fn(),
}));

function seedBuildableRuntimePackages(cwd: string, packages: string[]) {
	for (const packageName of packages) {
		const root = resolve(cwd, 'packages', packageName);
		mkdirSync(resolve(root, 'src'), { recursive: true });
		writeFileSync(resolve(root, 'package.json'), JSON.stringify({ scripts: { 'build:dist': 'node -e ""' } }), 'utf8');
	}
}

describe('managed dev process ownership', () => {
	afterEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});

	it('terminates the detached process group when its leader has left child processes behind', async () => {
		const cwd = mkdtempSync(resolve(tmpdir(), 'treeseed-managed-dev-'));
		const [spec] = createIntegratedDevPlan({ cwd, surfaces: 'web' }).processes;
		mkdirSync(resolve(spec.pidPath, '..'), { recursive: true });
		mkdirSync(resolve(spec.instancePath, '..'), { recursive: true });
		writeFileSync(spec.pidPath, '43121', 'utf8');
		writeFileSync(spec.instancePath, '{"pid":43121,"startedAt":"2026-07-14T00:00:00.000Z"}\n', 'utf8');

		let groupAlive = true;
		const kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
			if (pid !== -43121) throw Object.assign(new Error('missing'), { code: 'ESRCH' });
			if (signal === 0) {
				if (groupAlive) return true;
				throw Object.assign(new Error('missing'), { code: 'ESRCH' });
			}
			if (signal === 'SIGTERM') groupAlive = false;
			return true;
		}) as typeof process.kill);

		const result = await stopManagedDev({ cwd, surfaces: 'web' });

		expect(result.ok).toBe(true);
		expect(kill).toHaveBeenCalledWith(-43121, 'SIGTERM');
		expect(groupAlive).toBe(false);
	});

	it('requires a locked package-local install for a freshly materialized workset package', () => {
		const cwd = mkdtempSync(resolve(tmpdir(), 'treeseed-managed-dev-install-'));
		writeFileSync(resolve(cwd, 'package-lock.json'), '{"lockfileVersion":3}\n', 'utf8');

		expect(managedDevPackageInstallRequired(cwd)).toBe(true);
		mkdirSync(resolve(cwd, 'node_modules'), { recursive: true });
		writeFileSync(resolve(cwd, 'node_modules/.package-lock.json'), '{"lockfileVersion":3}\n', 'utf8');
		expect(managedDevPackageInstallRequired(cwd)).toBe(false);
	});

	it('runs API entrypoints from the independently installed package closure', () => {
		const cwd = mkdtempSync(resolve(tmpdir(), 'treeseed-managed-dev-api-command-'));
		const [api] = createIntegratedDevPlan({ cwd, surfaces: 'api' }).processes;

		expect(api?.command).toBe('npm');
		expect(api?.args).toEqual(['--prefix', resolve(cwd, 'packages/api'), 'run', 'dev:api']);
	});

	it('replaces a live managed process when its health check fails', async () => {
		const cwd = mkdtempSync(resolve(tmpdir(), 'treeseed-managed-dev-unhealthy-'));
		seedBuildableRuntimePackages(cwd, ['sdk', 'ui', 'core', 'admin', 'api', 'agent', 'cli']);
		const [spec] = createIntegratedDevPlan({ cwd, surfaces: 'web' }).processes;
		mkdirSync(resolve(spec.pidPath, '..'), { recursive: true });
		mkdirSync(resolve(spec.instancePath, '..'), { recursive: true });
		writeFileSync(spec.pidPath, '43121', 'utf8');
		writeFileSync(spec.instancePath, '{"pid":43121,"startedAt":"2026-07-14T00:00:00.000Z"}\n', 'utf8');

		let oldGroupAlive = true;
		vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
			if (pid === -43121 && signal === 0 && oldGroupAlive) return true;
			if (pid === -43121 && signal === 'SIGTERM') {
				oldGroupAlive = false;
				return true;
			}
			if (pid === -43122 && signal === 0) return true;
			throw Object.assign(new Error('missing'), { code: 'ESRCH' });
		}) as typeof process.kill);
		vi.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(new Response(null, { status: 500 }))
			.mockResolvedValue(new Response(null, { status: 200 }));
		vi.mocked(spawn).mockReturnValue({ pid: 43122, unref: vi.fn() } as never);

		const result = await startManagedDev({ cwd, surfaces: 'web' });

		expect(result.ok).toBe(true);
		expect(result.instances[0]?.pid).toBe(43122);
		expect(process.kill).toHaveBeenCalledWith(-43121, 'SIGTERM');
		expect(spawn).toHaveBeenCalledOnce();
	});

	it('replaces a healthy API process when its source closure changes', async () => {
		const cwd = mkdtempSync(resolve(tmpdir(), 'treeseed-managed-dev-source-'));
		seedBuildableRuntimePackages(cwd, ['sdk', 'api']);
		mkdirSync(resolve(cwd, 'packages/api/src'), { recursive: true });
		writeFileSync(resolve(cwd, 'packages/api/src/server.ts'), 'export const version = 1;\n', 'utf8');
		const [originalSpec] = createIntegratedDevPlan({ cwd, surfaces: 'api' }).processes;
		mkdirSync(resolve(originalSpec.pidPath, '..'), { recursive: true });
		mkdirSync(resolve(originalSpec.instancePath, '..'), { recursive: true });
		writeFileSync(originalSpec.pidPath, '43121', 'utf8');
		writeFileSync(originalSpec.instancePath, JSON.stringify({
			pid: 43121,
			startedAt: '2026-07-14T00:00:00.000Z',
			sourceClosureDigest: originalSpec.sourceClosureDigest,
		}), 'utf8');
		writeFileSync(resolve(cwd, 'packages/api/src/server.ts'), 'export const version = 2;\n', 'utf8');

		let oldGroupAlive = true;
		vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
			if (pid === -43121 && signal === 0 && oldGroupAlive) return true;
			if (pid === -43121 && signal === 'SIGTERM') {
				oldGroupAlive = false;
				return true;
			}
			if (pid === -43122 && signal === 0) return true;
			throw Object.assign(new Error('missing'), { code: 'ESRCH' });
		}) as typeof process.kill);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
		vi.mocked(spawn).mockReturnValue({ pid: 43122, unref: vi.fn() } as never);

		const result = await startManagedDev({ cwd, surfaces: 'api' });

		expect(result.ok).toBe(true);
		expect(result.instances[0]).toMatchObject({
			pid: 43122,
			sourceClosureMatches: true,
		});
		expect(process.kill).toHaveBeenCalledWith(-43121, 'SIGTERM');
		expect(spawn).toHaveBeenCalledOnce();
	});

	it('does not stop an unselected runtime while rebuilding a shared dependency', async () => {
		const cwd = mkdtempSync(resolve(tmpdir(), 'treeseed-managed-dev-scoped-'));
		seedBuildableRuntimePackages(cwd, ['sdk', 'api']);
		const [api] = createIntegratedDevPlan({ cwd, surfaces: 'api' }).processes;
		const [runner] = createIntegratedDevPlan({ cwd, surfaces: 'operations-runner' }).processes;
		for (const [spec, pid] of [[api, 43121], [runner, 43123]] as const) {
			mkdirSync(resolve(spec.pidPath, '..'), { recursive: true });
			mkdirSync(resolve(spec.instancePath, '..'), { recursive: true });
			writeFileSync(spec.pidPath, String(pid), 'utf8');
			writeFileSync(spec.instancePath, JSON.stringify({ pid, sourceClosureDigest: 'stale' }), 'utf8');
		}
		let apiAlive = true;
		const kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
			if (pid === -43121 && signal === 0 && apiAlive) return true;
			if (pid === -43121 && signal === 'SIGTERM') { apiAlive = false; return true; }
			if (pid === -43122 && signal === 0) return true;
			if (pid === -43123 && signal === 0) return true;
			throw Object.assign(new Error('missing'), { code: 'ESRCH' });
		}) as typeof process.kill);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
		vi.mocked(spawn).mockReturnValue({ pid: 43122, unref: vi.fn() } as never);

		const result = await startManagedDev({ cwd, surfaces: 'api' });

		expect(result.ok).toBe(true);
		expect(kill).toHaveBeenCalledWith(-43121, 'SIGTERM');
		expect(kill).not.toHaveBeenCalledWith(-43123, 'SIGTERM');
	});

	it('changes the API source closure when configured runtime values change', () => {
		const cwd = mkdtempSync(resolve(tmpdir(), 'treeseed-managed-dev-env-'));
		const [original] = createIntegratedDevPlan({
			cwd,
			surfaces: 'api',
			env: { TREESEED_API_BOOTSTRAP_ADMIN_ALLOWLIST: 'first@example.test' },
		}).processes;
		const [updated] = createIntegratedDevPlan({
			cwd,
			surfaces: 'api',
			env: { TREESEED_API_BOOTSTRAP_ADMIN_ALLOWLIST: 'second@example.test' },
		}).processes;

		expect(original?.sourceClosureDigest).not.toBe(updated?.sourceClosureDigest);
	});

	it('keeps the source closure stable when an identical build output is rewritten', () => {
		const cwd = mkdtempSync(resolve(tmpdir(), 'treeseed-managed-dev-identical-build-'));
		seedBuildableRuntimePackages(cwd, ['sdk', 'api']);
		mkdirSync(resolve(cwd, 'packages/sdk/dist'), { recursive: true });
		const output = resolve(cwd, 'packages/sdk/dist/index.js');
		writeFileSync(output, 'export const version = 1;\n', 'utf8');
		const [original] = createIntegratedDevPlan({ cwd, surfaces: 'api' }).processes;
		writeFileSync(output, 'export const version = 1;\n', 'utf8');
		const [rebuilt] = createIntegratedDevPlan({ cwd, surfaces: 'api' }).processes;

		expect(rebuilt?.sourceClosureDigest).toBe(original?.sourceClosureDigest);
	});

	it('pins both canonical service credential names in local API and web processes', () => {
		const cwd = mkdtempSync(resolve(tmpdir(), 'treeseed-managed-dev-service-'));
		const processes = createIntegratedDevPlan({ cwd, surfaces: 'web,api', env: {
			TREESEED_WEB_SERVICE_ID: 'stale-id', TREESEED_WEB_SERVICE_SECRET: 'stale-secret',
			TREESEED_API_WEB_SERVICE_ID: 'stale-api-id', TREESEED_API_WEB_SERVICE_SECRET: 'stale-api-secret',
		} }).processes;
		for (const processSpec of processes.filter((item) => item.surface === 'web' || item.surface === 'api')) {
			expect(processSpec.env).toMatchObject({
				TREESEED_WEB_SERVICE_ID: 'web',
				TREESEED_WEB_SERVICE_SECRET: 'treeseed-web-service-dev-secret',
				TREESEED_API_WEB_SERVICE_ID: 'web',
				TREESEED_API_WEB_SERVICE_SECRET: 'treeseed-web-service-dev-secret',
			});
		}
	});

	it('pins local TreeDX trust instead of inheriting hosted credentials', () => {
		const cwd = mkdtempSync(resolve(tmpdir(), 'treeseed-managed-dev-treedx-'));
		const processes = createIntegratedDevPlan({ cwd, surfaces: 'api,operations-runner', env: {
			TREESEED_TREEDX_URL: 'https://hosted.invalid',
			TREESEED_TREEDX_JWT_ISSUER: 'hosted-issuer',
			TREESEED_TREEDX_JWT_AUDIENCE: 'hosted-audience',
			TREESEED_TREEDX_JWT_HS256_SECRET: 'hosted-secret',
		} }).processes;
		for (const processSpec of processes) {
			expect(processSpec.env).toMatchObject({
				TREESEED_TREEDX_URL: 'http://127.0.0.1:4000',
				TREESEED_TREEDX_JWT_ISSUER: 'https://api.treeseed.local/treedx',
				TREESEED_TREEDX_JWT_AUDIENCE: 'treedx-local',
				TREESEED_TREEDX_JWT_HS256_SECRET: 'treeseed-local-treedx-jwt-secret',
			});
		}
	});
});
