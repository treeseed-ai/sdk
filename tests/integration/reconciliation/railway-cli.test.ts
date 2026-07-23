import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('../../../src/managed-dependencies.ts', () => ({
	resolveTreeseedToolCommand: vi.fn(() => ({ command: 'railway', argsPrefix: [] })),
}));
vi.mock('../../../src/service-credentials.ts', () => ({
	withTreeseedServiceCredentialEnv: vi.fn((env) => env),
}));

import { runRailwayCliJson } from '../../../src/operations/services/railway-cli.ts';

function fakeChild(pid: number) {
	const child = new EventEmitter() as EventEmitter & {
		pid: number;
		stdin: PassThrough;
		stdout: PassThrough;
		stderr: PassThrough;
		kill: ReturnType<typeof vi.fn>;
	};
	child.pid = pid;
	child.stdin = new PassThrough();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.kill = vi.fn(() => true);
	return child;
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	spawnMock.mockReset();
});

describe('Railway CLI execution', () => {
	it('terminates the complete process group when a provider command times out', async () => {
		vi.useFakeTimers();
		const child = fakeChild(42_424);
		spawnMock.mockReturnValue(child);
		const kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals) => {
			if (pid === -child.pid && signal === 'SIGTERM') {
				queueMicrotask(() => child.emit('close', null, signal));
			}
			return true;
		}) as typeof process.kill);

		const result = runRailwayCliJson({ args: ['status', '--json'], timeoutMs: 25 });
		const rejected = expect(result).rejects.toThrow('Railway CLI timed out after 25ms');
		await vi.advanceTimersByTimeAsync(25);

		await rejected;
		expect(kill).toHaveBeenCalledWith(-child.pid, 'SIGTERM');
	});

	it('clears its timeout and parses successful JSON output', async () => {
		vi.useFakeTimers();
		const child = fakeChild(42_425);
		spawnMock.mockReturnValue(child);
		const result = runRailwayCliJson<{ ok: boolean }>({ args: ['status', '--json'], timeoutMs: 25 });
		child.stdout.write('{"ok":true}');
		child.emit('close', 0);

		await expect(result).resolves.toEqual({ ok: true });
		await vi.advanceTimersByTimeAsync(100);
		expect(child.kill).not.toHaveBeenCalled();
	});
});
