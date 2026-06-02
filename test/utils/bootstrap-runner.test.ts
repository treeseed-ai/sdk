import { describe, expect, it } from 'vitest';
import { runPrefixedCommand, runTreeseedBootstrapDag } from '../../src/operations/services/bootstrap-runner.ts';

function delay(milliseconds: number) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe('bootstrap DAG runner', () => {
	it('runs independent nodes concurrently and waits for dependencies', async () => {
		const events: string[] = [];
		let active = 0;
		let maxActive = 0;
		await runTreeseedBootstrapDag({
			nodes: [
				{
					id: 'web:build',
					run: async () => {
						active += 1;
						maxActive = Math.max(maxActive, active);
						events.push('web:start');
						await delay(30);
						events.push('web:end');
						active -= 1;
					},
				},
				{
					id: 'data:d1-migrate',
					run: async () => {
						active += 1;
						maxActive = Math.max(maxActive, active);
						events.push('data:start');
						await delay(30);
						events.push('data:end');
						active -= 1;
					},
				},
				{
					id: 'web:publish',
					dependencies: ['web:build', 'data:d1-migrate'],
					run: () => {
						events.push('publish');
					},
				},
			],
			execution: 'parallel',
		});

		expect(maxActive).toBe(2);
		expect(events.indexOf('publish')).toBeGreaterThan(events.indexOf('web:end'));
		expect(events.indexOf('publish')).toBeGreaterThan(events.indexOf('data:end'));
	});

	it('runs ready nodes one at a time in sequential mode', async () => {
		let active = 0;
		let maxActive = 0;
		await runTreeseedBootstrapDag({
			nodes: [
				{
					id: 'api:deploy',
					run: async () => {
						active += 1;
						maxActive = Math.max(maxActive, active);
						await delay(10);
						active -= 1;
					},
				},
				{
					id: 'agents:deploy',
					run: async () => {
						active += 1;
						maxActive = Math.max(maxActive, active);
						await delay(10);
						active -= 1;
					},
				},
			],
			execution: 'sequential',
		});

		expect(maxActive).toBe(1);
	});

	it('records node timings and emits progress without changing results', async () => {
		const timings: Array<{ name: string; durationMs: number; status?: string }> = [];
		const writes: string[] = [];
		const result = await runTreeseedBootstrapDag<string>({
			nodes: [
				{ id: 'a', label: 'first task', run: () => 'one' },
				{ id: 'b', dependencies: ['a'], run: async () => 'two' },
			],
			execution: 'sequential',
			timings,
			write(line) {
				writes.push(line);
			},
		});

		expect(result.get('a')).toBe('one');
		expect(result.get('b')).toBe('two');
		expect(timings).toHaveLength(2);
		expect(timings[0]).toMatchObject({ name: 'bootstrap:first task', status: 'success' });
		expect(timings[0]?.durationMs).toBeGreaterThanOrEqual(0);
		expect(writes).toEqual(expect.arrayContaining([
			'[bootstrap][a] started',
			expect.stringMatching(/^\[bootstrap\]\[a\] completed in /u),
		]));
	});

	it('records failed node timings before rethrowing', async () => {
		const timings: Array<{ name: string; durationMs: number; status?: string; metadata?: Record<string, unknown> }> = [];

		await expect(runTreeseedBootstrapDag({
			nodes: [{ id: 'fail', run: () => { throw new Error('nope'); } }],
			timings,
		})).rejects.toThrow('nope');

		expect(timings).toHaveLength(1);
		expect(timings[0]).toMatchObject({
			name: 'bootstrap:fail',
			status: 'failed',
			metadata: expect.objectContaining({ error: 'nope' }),
		});
	});
});

describe('prefixed bootstrap process output', () => {
	it('prefixes stdout, stderr, and trailing partial lines', async () => {
		const writes: Array<{ line: string; stream?: 'stdout' | 'stderr' }> = [];
		const result = await runPrefixedCommand('bash', [
			'-lc',
			'printf "out-a\\nout-b"; printf "err-a\\nerr-b" >&2',
		], {
			cwd: process.cwd(),
			prefix: {
				scope: 'staging',
				system: 'web',
				task: 'publish',
				stage: 'deploy',
			},
			write(line, stream) {
				writes.push({ line, stream });
			},
		});

		expect(result.status).toBe(0);
		expect(writes).toContainEqual({ line: '[staging][web][publish][deploy] out-a', stream: 'stdout' });
		expect(writes).toContainEqual({ line: '[staging][web][publish][deploy] out-b', stream: 'stdout' });
		expect(writes).toContainEqual({ line: '[staging][web][publish][deploy] err-a', stream: 'stderr' });
		expect(writes).toContainEqual({ line: '[staging][web][publish][deploy] err-b', stream: 'stderr' });
	});
});
