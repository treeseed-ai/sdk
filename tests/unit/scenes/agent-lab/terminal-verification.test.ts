import { describe, expect, it, vi } from 'vitest';

import { retryAgentLabTerminalVerification } from '../../../../src/scenes/agent-lab/terminal-verification.ts';

describe('Agent Lab terminal verification', () => {
	it('retries transient read failures and preserves the durable terminal result', async () => {
		const operation = vi.fn()
			.mockRejectedValueOnce(new Error('Capacity acceptance terminal assignment inspection failed: fetch failed'))
			.mockResolvedValue({ finalStatus: 'completed' });

		await expect(retryAgentLabTerminalVerification(operation)).resolves.toEqual({ finalStatus: 'completed' });
		expect(operation).toHaveBeenCalledTimes(2);
	});

	it('does not retry a durable contract failure', async () => {
		const operation = vi.fn().mockRejectedValue(new Error('Capacity acceptance terminal assignment retained an active capability handle.'));

		await expect(retryAgentLabTerminalVerification(operation)).rejects.toThrow(/active capability handle/u);
		expect(operation).toHaveBeenCalledTimes(1);
	});
});
