import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { readBackPublishedPackage } from '../../../scripts/packages/published-package-readback.ts';

const artifact = Buffer.from('verified-sdk-artifact');
const digest = `sha256:${createHash('sha256').update(artifact).digest('hex')}`;
const input = {
	packageName: '@treeseed/sdk',
	packageVersion: '0.13.0-rc.1',
	packageDigest: digest,
	latestDistTag: '0.12.62',
	destination: '/fixture',
	cwd: '/fixture',
	readArtifact: () => artifact,
};

describe('published package read-back', () => {
	it('recovers only from transient visibility and rc propagation failures', async () => {
		const notVisible = Object.assign(new Error('not visible'), { stderr: 'npm ERR! code ETARGET' });
		const execNpm = vi.fn()
			.mockImplementationOnce(() => { throw notVisible; })
			.mockReturnValueOnce('[{"filename":"package.tgz"}]')
			.mockReturnValueOnce('{"latest":"0.12.62"}')
			.mockReturnValueOnce('{"latest":"0.12.62","rc":"0.13.0-rc.1"}');
		let now = 0;
		const result = await readBackPublishedPackage({
			...input,
			execNpm,
			now: () => now,
			delay: async (milliseconds) => { now += milliseconds; },
		});
		expect(result).toEqual({ packageVersion: '0.13.0-rc.1', packageDigest: digest, rc: '0.13.0-rc.1', latest: '0.12.62' });
		expect(execNpm).toHaveBeenCalledTimes(4);
	});

	it('stops retrying transient failures at the overall deadline', async () => {
		const timeout = Object.assign(new Error('timed out'), { stderr: 'npm ERR! code ETIMEDOUT' });
		const execNpm = vi.fn(() => { throw timeout; });
		let now = 0;
		await expect(readBackPublishedPackage({
			...input,
			execNpm,
			deadlineMs: 5,
			now: () => now,
			delay: async (milliseconds) => { now += milliseconds; },
		})).rejects.toThrow('timed out');
		expect(now).toBe(5);
		expect(execNpm).toHaveBeenCalledTimes(2);
	});

	it('fails immediately on authentication or configuration errors', async () => {
		const execNpm = vi.fn(() => { throw Object.assign(new Error('unauthorized'), { stderr: 'npm ERR! code E401' }); });
		const delay = vi.fn();
		await expect(readBackPublishedPackage({ ...input, execNpm, delay })).rejects.toThrow('unauthorized');
		expect(execNpm).toHaveBeenCalledTimes(1);
		expect(delay).not.toHaveBeenCalled();
	});

	it('fails immediately when latest moves', async () => {
		const execNpm = vi.fn()
			.mockReturnValueOnce('[{"filename":"package.tgz"}]')
			.mockReturnValueOnce('{"latest":"0.13.0-rc.1","rc":"0.13.0-rc.1"}');
		const delay = vi.fn();
		await expect(readBackPublishedPackage({ ...input, execNpm, delay })).rejects.toThrow('npm latest changed');
		expect(delay).not.toHaveBeenCalled();
	});

	it('fails before tag observation when the published artifact differs', async () => {
		const execNpm = vi.fn().mockReturnValueOnce('[{"filename":"package.tgz"}]');
		await expect(readBackPublishedPackage({ ...input, packageDigest: 'sha256:wrong', execNpm })).rejects.toThrow('does not match');
		expect(execNpm).toHaveBeenCalledTimes(1);
	});
});
