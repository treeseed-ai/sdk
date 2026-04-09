import { describe, expect, it, vi } from 'vitest';
import {
	findTreeseedOperation,
	parseTreeseedInvocation,
	TRESEED_OPERATION_SPECS,
	TreeseedOperationsSdk,
	validateTreeseedInvocation,
} from '../../src/operations.ts';

describe('treeseed operations registry', () => {
	it('covers the full CLI command surface', () => {
		expect(TRESEED_OPERATION_SPECS.map((spec) => spec.name)).toEqual([
			'setup',
			'work',
			'ship',
			'prepare',
			'publish',
			'promote',
			'rollback',
			'teardown',
			'continue',
			'status',
			'next',
			'doctor',
			'auth:login',
			'auth:logout',
			'auth:whoami',
			'template',
			'sync',
			'init',
			'config',
			'start',
			'close',
			'deploy',
			'save',
			'release',
			'destroy',
			'dev',
			'dev:watch',
			'build',
			'check',
			'preview',
			'lint',
			'test',
			'test:unit',
			'preflight',
			'auth:check',
			'test:e2e',
			'test:e2e:local',
			'test:e2e:staging',
			'test:e2e:full',
			'test:release',
			'test:release:full',
			'release:publish:changed',
			'astro',
			'sync:devvars',
			'mailpit:up',
			'mailpit:down',
			'mailpit:logs',
			'd1:migrate:local',
			'cleanup:markdown',
			'cleanup:markdown:check',
			'starlight:patch',
		]);
	});

	it('resolves aliases through the shared registry', () => {
		expect(findTreeseedOperation('release:verify')?.name).toBe('test:release:full');
	});
});

describe('treeseed operation parsing', () => {
	it('parses repeatable and message-tail args', () => {
		const setup = findTreeseedOperation('setup');
		const ship = findTreeseedOperation('ship');
		if (!setup || !ship) {
			throw new Error('Expected setup and ship specs.');
		}

		const setupInvocation = parseTreeseedInvocation(setup, ['--environment', 'local', '--environment', 'staging']);
		const shipInvocation = parseTreeseedInvocation(ship, ['feat:', 'ship', 'from', 'sdk']);

		expect(setupInvocation.args.environment).toEqual(['local', 'staging']);
		expect(shipInvocation.positionals.join(' ')).toBe('feat: ship from sdk');
	});

	it('validates deploy targeting and version bump rules', () => {
		const deploy = findTreeseedOperation('deploy');
		const promote = findTreeseedOperation('promote');
		if (!deploy || !promote) {
			throw new Error('Expected deploy and promote specs.');
		}

		expect(validateTreeseedInvocation(deploy, parseTreeseedInvocation(deploy, []))).toHaveLength(1);
		expect(validateTreeseedInvocation(promote, parseTreeseedInvocation(promote, ['--patch', '--minor']))).toHaveLength(1);
	});
});

describe('treeseed operations runtime', () => {
	it('delegates handler execution through the registered resolver', async () => {
		const handler = vi.fn(async () => ({
			exitCode: 0,
			stdout: ['ok'],
			report: { ok: true },
		}));
		const write = vi.fn();
		const sdk = new TreeseedOperationsSdk({
			resolveHandler: (name) => (name === 'status' ? handler : null),
		});

		const exitCode = await sdk.executeOperation({
			commandName: 'status',
			argv: ['--json'],
		}, {
			write,
			cwd: process.cwd(),
			env: process.env,
			spawn: vi.fn(),
		});

		expect(exitCode).toBe(0);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledTimes(1);
	});

	it('executes adapter commands through the shared adapter resolver', async () => {
		const spawn = vi.fn(() => ({ status: 0 }));
		const sdk = new TreeseedOperationsSdk({
			resolveAdapter: () => ({
				scriptPath: '/tmp/tenant-build.js',
				extraArgs: ['--full'],
			}),
		});

		const exitCode = await sdk.executeOperation({
			commandName: 'build',
			argv: ['--watch'],
		}, {
			write: vi.fn(),
			cwd: '/workspace',
			env: process.env,
			spawn,
		});

		expect(exitCode).toBe(0);
		expect(spawn).toHaveBeenCalledWith(
			process.execPath,
			['/tmp/tenant-build.js', '--full', '--watch'],
			expect.objectContaining({ cwd: '/workspace' }),
		);
	});
});
