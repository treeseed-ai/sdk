import { describe, expect, it } from 'vitest';
import { MarketClient, MarketClientError } from '../../../src/market-client.ts';

describe('MarketClient errors', () => {
	it('preserves top-level API error messages and their structured payload', async () => {
		const payload = {
			ok: false,
			code: 'blocked',
			message: 'Team still has owned content.',
			blockers: [{ code: 'project', id: 'project-a' }],
		};
		const client = new MarketClient({
			profile: { id: 'local', label: 'Local', baseUrl: 'http://market.test', kind: 'specialized' },
			accessToken: 'test-token',
			fetchImpl: async () => new Response(JSON.stringify(payload), {
				status: 400,
				headers: { 'content-type': 'application/json' },
			}),
		});

		await expect(client.deleteTeam('team-a', 'DELETE team-a')).rejects.toMatchObject<Partial<MarketClientError>>({
			name: 'MarketClientError',
			message: 'Team still has owned content.',
			status: 400,
			payload,
		});
	});

	it('includes the durable operation identity returned for idempotency conflicts', async () => {
		const client = new MarketClient({
			profile: { id: 'local', label: 'Local', baseUrl: 'http://market.test', kind: 'specialized' },
			fetchImpl: async () => new Response(JSON.stringify({
				ok: false, error: 'The idempotency key is already bound to different operation input.',
				code: 'capacity_idempotency_key_conflict', details: { operation: 'capacity-grant.transition.revoke' },
			}), { status: 409, headers: { 'content-type': 'application/json' } }),
		});
		await expect(client.deleteTeam('team-a', 'DELETE team-a')).rejects.toThrow(
			'The idempotency key is already bound to different operation input. (operation: capacity-grant.transition.revoke)',
		);
	});
});
