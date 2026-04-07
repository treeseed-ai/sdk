import { describe, expect, it } from 'vitest';
import {
	createCursorEnvelope,
	createLeaseEnvelope,
	createMessageEnvelope,
	createRunEnvelope,
	createSubscriptionEnvelope,
	cursorEntityFromEnvelope,
	leaseEntityFromEnvelope,
	messageEntityFromEnvelope,
	runEntityFromEnvelope,
	subscriptionEntityFromEnvelope,
	TRESEED_ENVELOPE_SCHEMA_VERSION,
} from '../../src/stores/envelopes.ts';

describe('treeseed envelope helpers', () => {
	it('normalizes subscription envelopes into stable SDK entities', () => {
		const envelope = createSubscriptionEnvelope({
			email: 'person@example.com',
			name: 'Person',
			source: 'footer',
			consentAt: '2026-04-07T00:00:00.000Z',
			ipHash: 'abc123',
		});

		const entity = subscriptionEntityFromEnvelope({
			id: 7,
			record_type: 'subscription',
			record_key: envelope.payload.email,
			lookup_key: envelope.payload.email,
			status: envelope.status,
			schema_version: envelope.schemaVersion,
			created_at: '2026-04-07T00:00:00.000Z',
			updated_at: '2026-04-07T00:00:00.000Z',
			payload_json: JSON.stringify(envelope.payload),
			meta_json: JSON.stringify(envelope.meta),
		});

		expect(entity.recordType).toBe('subscription');
		expect(entity.schemaVersion).toBe(TRESEED_ENVELOPE_SCHEMA_VERSION);
		expect(entity.email).toBe('person@example.com');
		expect(entity.source).toBe('footer');
		expect(entity.ip_hash).toBe('abc123');
	});

	it('normalizes message queue rows with JSON payloads', () => {
		const envelope = createMessageEnvelope({
			type: 'task.created',
			payload: { ok: true, nested: { id: 1 } },
			meta: { actor: 'tester' },
		});

		const entity = messageEntityFromEnvelope({
			id: 2,
			message_type: 'task.created',
			status: envelope.status,
			schema_version: envelope.schemaVersion,
			priority: 5,
			available_at: '2026-04-07T00:00:00.000Z',
			attempts: 0,
			max_attempts: 3,
			created_at: '2026-04-07T00:00:00.000Z',
			updated_at: '2026-04-07T00:00:00.000Z',
			payload_json: JSON.stringify(envelope.payload),
			meta_json: JSON.stringify(envelope.meta),
		});

		expect(entity.recordType).toBe('message');
		expect(entity.type).toBe('task.created');
		expect(JSON.parse(entity.payloadJson)).toEqual({ ok: true, nested: { id: 1 } });
		expect(entity.metaJson).toContain('tester');
	});

	it('upcasts run envelopes into the existing run entity shape', () => {
		const envelope = createRunEnvelope({
			runId: 'run-1',
			agentSlug: 'reviewer',
			status: 'completed',
			triggerSource: 'queue',
			startedAt: '2026-04-07T00:00:00.000Z',
			handlerKind: 'review',
			triggerKind: 'message',
			selectedItemKey: 'objective:1',
			selectedMessageId: 11,
			claimedMessageId: 10,
			branchName: 'feature/test',
			prUrl: 'https://example.test/pr/1',
			summary: 'done',
			error: null,
			errorCategory: null,
			commitSha: 'abc123',
			changedPaths: ['a.md', 'b.md'],
			finishedAt: '2026-04-07T00:05:00.000Z',
		});

		const entity = runEntityFromEnvelope({
			record_type: 'agent_run',
			record_key: 'run-1',
			lookup_key: 'reviewer',
			secondary_key: 'abc123',
			status: 'completed',
			schema_version: 1,
			created_at: '2026-04-07T00:00:00.000Z',
			updated_at: '2026-04-07T00:05:00.000Z',
			payload_json: JSON.stringify(envelope.payload),
			meta_json: JSON.stringify(envelope.meta),
		});

		expect(entity.runId).toBe('run-1');
		expect(entity.agentSlug).toBe('reviewer');
		expect(entity.commitSha).toBe('abc123');
		expect(entity.changedPaths).toEqual(['a.md', 'b.md']);
		expect(entity.finishedAt).toBe('2026-04-07T00:05:00.000Z');
	});

	it('preserves cursor and lease envelopes through normalized entity helpers', () => {
		const cursorEnvelope = createCursorEnvelope({
			agentSlug: 'reviewer',
			cursorKey: 'queue',
			cursorValue: '42',
		});
		const leaseEnvelope = createLeaseEnvelope({
			token: 'lease-token',
			meta: { actor: 'reviewer' },
		});

		const cursor = cursorEntityFromEnvelope({
			agent_slug: 'reviewer',
			cursor_key: 'queue',
			status: cursorEnvelope.status,
			schema_version: cursorEnvelope.schemaVersion,
			updated_at: '2026-04-07T00:00:00.000Z',
			payload_json: JSON.stringify(cursorEnvelope.payload),
			meta_json: JSON.stringify(cursorEnvelope.meta),
		});
		const lease = leaseEntityFromEnvelope({
			model: 'objective',
			item_key: 'goal-1',
			status: leaseEnvelope.status,
			schema_version: leaseEnvelope.schemaVersion,
			claimed_by: 'reviewer',
			claimed_at: '2026-04-07T00:00:00.000Z',
			lease_expires_at: '2026-04-07T00:05:00.000Z',
			created_at: '2026-04-07T00:00:00.000Z',
			updated_at: '2026-04-07T00:00:00.000Z',
			payload_json: JSON.stringify(leaseEnvelope.payload),
			meta_json: JSON.stringify(leaseEnvelope.meta),
		});

		expect(cursor.cursorValue).toBe('42');
		expect(lease.token).toBe('lease-token');
		expect(lease.model).toBe('objective');
	});
});
