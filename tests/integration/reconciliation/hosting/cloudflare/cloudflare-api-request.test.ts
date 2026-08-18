import { describe, expect, it, vi } from 'vitest';

const spawnSyncMock = vi.fn();

vi.mock('node:child_process', () => ({
	spawnSync: spawnSyncMock,
}));

describe('cloudflare api request helper', () => {
	it('retries structured transient fetch failures and returns the eventual payload', async () => {
		spawnSyncMock
			.mockReturnValueOnce({
				status: 0,
				stdout: JSON.stringify({
					ok: false,
					transient: true,
					payload: { success: false, errors: [{ message: 'fetch failed; ETIMEDOUT' }] },
				}),
				stderr: '',
			})
			.mockReturnValueOnce({
				status: 0,
				stdout: JSON.stringify({
					ok: true,
					payload: { success: true, result: [{ name: 'background-events' }] },
				}),
				stderr: '',
			});
		const { cloudflareApiRequest } = await import('../../../../../src/operations/services/hosting/deployment/deploy.ts');

		expect(cloudflareApiRequest('/accounts/account/queues', {
			env: { TREESEED_CLOUDFLARE_API_TOKEN: 'token' },
		})).toEqual({ success: true, result: [{ name: 'background-events' }] });
		expect(spawnSyncMock).toHaveBeenCalledTimes(2);
	}, 30000);

	it('reports transient failures without leaking child process stack traces', async () => {
		spawnSyncMock.mockReset();
		spawnSyncMock.mockReturnValue({
			status: 0,
			stdout: JSON.stringify({
				ok: false,
				transient: true,
				payload: { success: false, errors: [{ message: 'fetch failed; connect ETIMEDOUT 104.19.192.176:443' }] },
			}),
			stderr: '',
		});
		const { cloudflareApiRequest } = await import('../../../../../src/operations/services/hosting/deployment/deploy.ts');

		expect(() => cloudflareApiRequest('/accounts/account/queues', {
			env: { TREESEED_CLOUDFLARE_API_TOKEN: 'token' },
		})).toThrow(/Cloudflare API request failed after \d+ attempts: GET \/accounts\/account\/queues: fetch failed; connect ETIMEDOUT/u);
	}, 30000);
});
