import { describe, expect, it } from 'vitest';
import { createGatewayHealthHandlers } from '../../../src/gateway/health.ts';

describe('Market gateway health', () => {
	it('keeps process health available while deep health and readiness expose Admin degradation', async () => {
		const health = createGatewayHealthHandlers({
			checks: {
				'market-database': async () => true,
				'admin-api': async () => false,
				'internal-auth': async () => true,
				'provider-bindings': async () => true,
			},
		});

		expect(health.process().status).toBe(200);
		expect((await health.deep()).status).toBe(503);
		expect((await health.ready()).status).toBe(503);
	});
});
