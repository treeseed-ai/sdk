import { describe, expect, it } from 'vitest';
import { MemoryAgentDatabase } from '../../src/d1-store.ts';
import { AgentSdk } from '../../src/sdk.ts';
import { sdkFixtureRoot } from '../test-fixture.ts';

describe('agent sdk', () => {
	it('reads content-backed models through the public knowledge alias', async () => {
		const sdk = new AgentSdk({
			repoRoot: sdkFixtureRoot,
			database: new MemoryAgentDatabase(),
		});
		const response = await sdk.search({
			model: 'knowledge',
			limit: 3,
			filters: [{ field: 'title', op: 'contains', value: 'TreeSeed' }],
		});

		expect(response.ok).toBe(true);
		expect(response.model).toBe('knowledge');
		expect(response.payload.length).toBeGreaterThan(0);
		expect(response.payload[0]).toHaveProperty('body');
	});

	it('supports read as a public alias for get', async () => {
		const sdk = new AgentSdk({
			repoRoot: sdkFixtureRoot,
			database: new MemoryAgentDatabase(),
		});
		const response = await sdk.read({
			model: 'knowledge',
			slug: 'research/inquiry/questions-as-records',
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
			repoRoot: sdkFixtureRoot,
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
			repoRoot: sdkFixtureRoot,
			database: new MemoryAgentDatabase(),
		});

		const response = await sdk.search({
			model: 'person',
			limit: 1,
		});

		expect(response.model).toBe('person');
		expect(Array.isArray(response.payload)).toBe(true);
	});

	it('searches representative page and note content from the fixture site', async () => {
		const sdk = new AgentSdk({
			repoRoot: sdkFixtureRoot,
			database: new MemoryAgentDatabase(),
		});

		const pageResponse = await sdk.search({
			model: 'page',
			limit: 1,
			filters: [{ field: 'title', op: 'contains', value: 'Vision' }],
		});
		const noteResponse = await sdk.search({
			model: 'note',
			limit: 1,
			filters: [{ field: 'title', op: 'contains', value: 'fixture' }],
		});

		expect(pageResponse.model).toBe('page');
		expect(pageResponse.payload.length).toBeGreaterThan(0);
		expect(noteResponse.model).toBe('note');
		expect(noteResponse.payload.length).toBeGreaterThan(0);
	});

	it('finds at least one generic agent entry in the fixture site', async () => {
		const sdk = new AgentSdk({
			repoRoot: sdkFixtureRoot,
			database: new MemoryAgentDatabase(),
		});

		const response = await sdk.search({
			model: 'agent',
			limit: 1,
			filters: [{ field: 'name', op: 'contains', value: 'Planner' }],
		});

		expect(response.model).toBe('agent');
		expect(response.payload.length).toBeGreaterThan(0);
		expect(response.payload[0]).toHaveProperty('frontmatter');
	});
});
