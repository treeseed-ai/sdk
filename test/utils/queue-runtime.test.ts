import { describe, expect, it, vi } from 'vitest';
import { CloudflareQueuePushClient } from '../../src/remote.ts';

describe('queue runtime clients', () => {
	it('pushes queue messages through the Cloudflare queues API', async () => {
		const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
		const client = new CloudflareQueuePushClient({
			accountId: 'account-123',
			queueId: 'queue-123',
			token: 'push-secret',
			fetchImpl: async (input, init) => {
				calls.push({
					url: String(input),
					body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
				});
				return new Response(JSON.stringify({ success: true, result: {} }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			},
		});

		await client.enqueue({
			message: {
				messageId: 'msg-1',
				taskId: 'task-1',
				workDayId: 'workday-1',
				agentId: 'market-curator',
				taskType: 'agent_root',
				idempotencyKey: 'workday-1:market-curator',
				attempt: 1,
				payloadRef: 'd1:tasks/task-1',
				graphVersion: 'graph-1',
				budgetHint: 1,
			},
			delaySeconds: 15,
		});

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe('https://api.cloudflare.com/client/v4/accounts/account-123/queues/queue-123/messages');
		expect(calls[0]?.body).toMatchObject({
			content_type: 'json',
			delay_seconds: 15,
			body: {
				taskId: 'task-1',
			},
		});
	});
});
