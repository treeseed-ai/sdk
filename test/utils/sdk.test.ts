import { describe, expect, it } from 'vitest';
import { MemoryAgentDatabase } from '../../src/d1-store.ts';
import { AgentSdk } from '../../src/sdk.ts';

describe('agent sdk', () => {
	it('reads content-backed models through the public knowledge alias', async () => {
		const sdk = new AgentSdk({
			repoRoot: process.cwd(),
			database: new MemoryAgentDatabase(),
		});
		const response = await sdk.search({
			model: 'knowledge',
			limit: 3,
			filters: [{ field: 'title', op: 'contains', value: 'Introduction' }],
		});

		expect(response.ok).toBe(true);
		expect(response.model).toBe('knowledge');
		expect(response.payload.length).toBeGreaterThan(0);
		expect(response.payload[0]).toHaveProperty('body');
	});

	it('supports read as a public alias for get', async () => {
		const sdk = new AgentSdk({
			repoRoot: process.cwd(),
			database: new MemoryAgentDatabase(),
		});
		const response = await sdk.read({
			model: 'knowledge',
			slug: 'architecture/part-1/chapter-1/1-introduction',
		});

		expect(response.ok).toBe(true);
		expect(response.operation).toBe('read');
		expect(response.payload).toHaveProperty('slug');
	});

	it('claims the highest-priority pending message exactly once', async () => {
		const database = new MemoryAgentDatabase({
			messages: [
				{
					id: 1,
					type: 'task_complete',
					status: 'pending',
					payloadJson: '{"ok":true}',
					relatedModel: null,
					relatedId: null,
					priority: 5,
					availableAt: new Date(Date.now() - 1000).toISOString(),
					claimedBy: null,
					claimedAt: null,
					leaseExpiresAt: null,
					attempts: 0,
					maxAttempts: 3,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				},
			],
		});
		const sdk = new AgentSdk({
			repoRoot: process.cwd(),
			database,
		});

		const first = await sdk.pick({
			model: 'message',
			leaseSeconds: 60,
			workerId: 'reviewer-1',
		});
		const second = await sdk.pick({
			model: 'message',
			leaseSeconds: 60,
			workerId: 'reviewer-2',
		});

		expect(first.payload.item).not.toBeNull();
		expect((first.payload.item as { claimedBy?: string } | null)?.claimedBy).toBe('reviewer-1');
		expect(second.payload.item).toBeNull();
	});

	it('resolves the expanded public model set', async () => {
		const sdk = new AgentSdk({
			repoRoot: process.cwd(),
			database: new MemoryAgentDatabase(),
		});

		const response = await sdk.search({
			model: 'person',
			limit: 1,
		});

		expect(response.model).toBe('person');
		expect(Array.isArray(response.payload)).toBe(true);
	});
});
