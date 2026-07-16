import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTreeseedIntegratedDevPlan, startTreeseedManagedDev, stopTreeseedManagedDev } from '../../src/local-dev/managed-dev.ts';

vi.mock('node:child_process', async (importOriginal) => ({
	...await importOriginal<typeof import('node:child_process')>(),
	spawn: vi.fn(),
}));

describe('managed dev process ownership', () => {
	afterEach(() => vi.restoreAllMocks());

	it('terminates the detached process group when its leader has left child processes behind', async () => {
		const cwd = mkdtempSync(resolve(tmpdir(), 'treeseed-managed-dev-'));
		const [spec] = createTreeseedIntegratedDevPlan({ cwd, surfaces: 'web' }).processes;
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

		const result = await stopTreeseedManagedDev({ cwd, surfaces: 'web' });

		expect(result.ok).toBe(true);
		expect(kill).toHaveBeenCalledWith(-43121, 'SIGTERM');
		expect(groupAlive).toBe(false);
	});

	it('replaces a live managed process when its health check fails', async () => {
		const cwd = mkdtempSync(resolve(tmpdir(), 'treeseed-managed-dev-unhealthy-'));
		const [spec] = createTreeseedIntegratedDevPlan({ cwd, surfaces: 'web' }).processes;
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

		const result = await startTreeseedManagedDev({ cwd, surfaces: 'web' });

		expect(result.ok).toBe(true);
		expect(result.instances[0]?.pid).toBe(43122);
		expect(process.kill).toHaveBeenCalledWith(-43121, 'SIGTERM');
		expect(spawn).toHaveBeenCalledOnce();
	});
});
