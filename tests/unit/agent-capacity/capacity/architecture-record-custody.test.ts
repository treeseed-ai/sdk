import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as publicContracts from '../../../../src/capacity/agents/agent-capacity.ts';
import { assignmentAttemptSchema, assignmentResultSchema, usageSettlementSchema, validateProviderAssignment } from '../../../../src/capacity/agents/agent-capacity.ts';

// Complete isolated public-schema inputs, not a compiled API admission or a
// live Lease/Reservation/Settlement. Never convert operational rows into them.
function supplied() {
	const ref = { store: 'treedx', model: 'proposal', id: 'proposal', repository: 'library', commit: 'a'.repeat(40), path: 'proposals/work.mdx' };
	const attempt = assignmentAttemptSchema.parse({ schemaVersion: 'treeseed.assignment-attempt/v1', id: 'attempt', idempotencyKey: 'attempt',
		teamId: 'team', projectId: 'project', workdayId: 'workday', nodeId: 'node', nodeRevision: 1, graphRevision: 1, agentClass: 'configured-renamed-author',
		sourceRef: ref, authorityRefs: [ref], effectiveProfile: { profileRef: { ...ref, model: 'agent', id: 'configured/renamed-author', path: 'agents/author.yaml' },
			activity: 'acting', handler: 'actor', handlerOrigin: 'agent-package', prompt: { system: 'Only the governed work item.' },
			permissionCeiling: { content: { read: ['proposal'], write: [] }, tools: ['source.read'] } },
		requiredCapabilities: [], grant: { contentRead: [ref], contentWrite: [], sourceRead: ['source'], sourceWrite: [], tools: ['source.read'] },
		provider: { providerId: 'provider', offerId: 'offer', offerRevision: 1, executionProviderId: 'executor', modelConfigurationId: 'model', executionCapabilityId: 'capability', runtimeBuild: `sha256:${'b'.repeat(64)}` },
		contextRefs: [ref], predecessorResultIds: [], workspace: { mode: 'read-only' },
		estimate: { expectedSeconds: 1, maximumSeconds: 2 }, limits: { maximumSeconds: 2, maximumContextBytes: 1024, maximumContextItems: 1 }, deadline: '2026-10-03T00:00:02.000Z',
		leaseId: 'lease', reservationId: 'reservation', attempt: 1, status: 'completed', createdAt: '2026-10-03T00:00:00.000Z' });
	const result = assignmentResultSchema.parse({ schemaVersion: 'treeseed.assignment-result/v1', id: 'result', assignmentId: attempt.id, status: 'completed',
		summary: 'Supplied result for validator tests only.', references: [], verification: [], usage: { elapsedSeconds: 1 }, diagnostics: [], completedAt: '2026-10-03T00:00:01.000Z' });
	const item: Record<string, unknown> = { id: attempt.id, membershipId: 'membership', stateVersion: 1, teamId: attempt.teamId, projectId: attempt.projectId,
		capacityProviderId: attempt.provider.providerId, projectAgentClassId: 'opaque-project-class-row', workDayId: attempt.workdayId, reservationId: attempt.reservationId,
		executionProviderId: attempt.provider.executionProviderId,
		executionNodeId: attempt.nodeId, executionNodeRevision: attempt.nodeRevision, graphRevision: attempt.graphRevision, mode: 'acting', status: 'completed',
		leaseState: 'released', attemptCount: attempt.attempt, assignmentAttempt: attempt, assignmentResult: result,
		capacityEnvelope: { teamId: attempt.teamId, projectId: attempt.projectId, mode: 'acting', workDayId: attempt.workdayId,
			projectAgentClassId: 'opaque-project-class-row', capacityProviderId: attempt.provider.providerId,
			executionProviderId: attempt.provider.executionProviderId, reservationId: attempt.reservationId },
		workspaceContext: {}, allowedOutputs: {}, explanation: {}, lifecycleOutput: {}, metadata: {},
		createdAt: attempt.createdAt, updatedAt: result.completedAt, completedAt: result.completedAt, synthesizedFrom: 'living_execution_graph' };
	return { item, attempt, result };
}
describe('public assignment whole immutable record custody', () => {
	function verifySupplyRecord(kind: 'provider-offer' | 'provider-state', native: boolean) {
		const clock = '2026-10-03T00:00:00.000Z';
		const original: Record<string, unknown> = kind === 'provider-offer'
			? { schemaVersion: 'treeseed.provider-offer/v1', id: 'offer', providerId: 'provider', revision: 1,
				runtimeBuild: `sha256:${'b'.repeat(64)}`, capabilities: ['implementation'], toolGroups: ['source.read'],
				maximumConcurrency: 1, availability: [{ startsAt: clock, endsAt: clock }], nativeLimits: [{ name: 'tokens', unit: 'tokens', maximum: .5 }], validFrom: clock }
			: { schemaVersion: 'treeseed.provider-state/v1', providerId: 'provider', offerId: 'offer', healthy: false,
				activeAssignmentIds: [], observedNativeUsage: { tokens: .125 }, observedAt: clock };
		const entries = [{ record: original, valid: true }];
		for (const field of Object.keys(original)) {
			entries.push({ record: Object.fromEntries(Object.entries(original).filter(([key]) => key !== field)), valid: false });
			for (const value of [undefined, null, '', {}]) {
				if (field === 'observedNativeUsage' && value && typeof value === 'object') continue;
				entries.push({ record: { ...original, [field]: value }, valid: false });
			}
		}
		const patches = kind === 'provider-offer'
			? [{ revision: 0 }, { revision: .5 }, { maximumConcurrency: 0 }, { maximumConcurrency: '1' },
				{ capabilities: ['implementation', 'implementation'] }, { toolGroups: ['unsafe-command'] }, { toolGroups: ['source.read', 'source.read'] },
				{ availability: [] }, { availability: [{ startsAt: 'invalid', endsAt: clock }] }, { availability: [{ startsAt: clock, endsAt: clock, extended: true }] },
				{ nativeLimits: [{ name: 'tokens', unit: 'tokens', maximum: 0 }] }, { nativeLimits: [{ name: 'tokens', unit: 'tokens', maximum: Infinity }] },
				{ runtimeBuild: 'legacy-build' }, { validUntil: 'invalid' }]
			: [{ activeAssignmentIds: ['attempt', 'attempt'] }, { healthy: 'false' }, { observedNativeUsage: { tokens: -1 } },
				{ observedNativeUsage: { tokens: NaN } }, { observedNativeUsage: { tokens: Infinity } }, { observedNativeUsage: { tokens: '1' } }, { observedAt: 'invalid' }];
		for (const patch of [...patches, { providerId: ' padded ' }, { providerId: 'a'.repeat(201) }, { schemaVersion: 'legacy/v1' },
			{ token: 'prohibited' }, { minimumSeconds: 10 }, { legacy: true }]) entries.push({ record: { ...original, ...patch }, valid: false });
		if (kind === 'provider-offer') {
			for (const field of ['revision', 'maximumConcurrency']) for (const value of [-1, .5, NaN, Infinity, -Infinity, '1', true])
				entries.push({ record: { ...original, [field]: value }, valid: false });
			for (const availability of [[{ startsAt: clock }], [{ endsAt: clock }], [{ startsAt: null, endsAt: clock }]])
				entries.push({ record: { ...original, availability }, valid: false });
			for (const nativeLimits of [[{ name: 'tokens', maximum: 1 }], [{ unit: 'tokens', maximum: 1 }], [{ name: ' padded ', unit: 'tokens', maximum: 1 }], [{ name: 'tokens', unit: 'tokens', maximum: '1' }]])
				entries.push({ record: { ...original, nativeLimits }, valid: false });
		}
		entries.push({ record: { ...original, providerId: 'a'.repeat(200) }, valid: true });
		entries.push({ record: kind === 'provider-offer' ? { ...original, capabilities: [], toolGroups: [], nativeLimits: [], validUntil: clock }
			: { ...original, healthy: true, activeAssignmentIds: ['attempt'], observedNativeUsage: {} }, valid: true });
		const held = structuredClone(entries);
		if (native) {
			const path = fileURLToPath(new URL('../../content/architecture/closeout-native.ts', import.meta.url)), bytes = readFileSync(path);
			const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path, kind], {
				input: JSON.stringify(entries.map(({ record }) => record)), encoding: 'utf8', timeout: 15_000,
			});
			expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
			const output: unknown = JSON.parse(child.stdout); if (!Array.isArray(output)) throw new Error('Native supply observations required.');
			expect(output).toHaveLength(entries.length);
			for (const [index, entry] of entries.entries()) expect(output[index]).toMatchObject(entry.valid ? { success: true, data: entry.record } : { success: false });
			expect(readFileSync(path)).toEqual(bytes);
		} else {
			const exports: Record<string, unknown> = publicContracts, schema = exports[kind === 'provider-offer' ? 'providerOfferSchema' : 'providerStateSchema'];
			if (!(schema instanceof z.ZodType)) throw new Error('Missing exact public supply validator.');
			for (const entry of entries) expect(schema.safeParse(entry.record)).toMatchObject(entry.valid ? { success: true, data: entry.record } : { success: false });
		}
		expect(entries).toEqual(held);
	}
	it('validates exact canonical provider offer supply without normalizing malformed or prohibited fields', () => verifySupplyRecord('provider-offer', false));
	it('native public provider offer validation retains complete supply bytes and denies malformed or duplicate authority', () => verifySupplyRecord('provider-offer', true));
	it('validates exact canonical provider state without coercing health native units or assignment inventory', () => verifySupplyRecord('provider-state', false));
	it('native public provider state validation retains actual supplied units and denies noncanonical observations', () => verifySupplyRecord('provider-state', true));
	it('requires the authorized context value field while retaining null scalar and structured payload bytes without changing authority', () => {
		const f = supplied(), schema = publicContracts.authorizedContextItemSchema;
		const original = { ref: f.attempt.sourceRef, mediaType: 'application/json', digest: `sha256:${'a'.repeat(64)}` };
		for (const value of [null, false, 0, '', [], {}, { evidence: ['exact', 1] }]) {
			const input = { ...original, value }, before = structuredClone(input);
			expect(schema.parse(input)).toEqual(input); expect(input).toEqual(before);
		}
		for (const input of [original, { ...original, value: undefined }, { ...original, value: {}, grant: {} }]) {
			const before = structuredClone(input);
			expect(schema.safeParse(input).success).toBe(false); expect(input).toEqual(before);
		}
	});
	function verifyCanonicalRecord(kind: 'lease' | 'reservation') {
		const exports: Record<string, unknown> = publicContracts, schema = exports[`${kind}Schema`];
		expect(schema).toBeInstanceOf(z.ZodType);
		if (!(schema instanceof z.ZodType)) throw new Error(`Missing public ${kind} validator.`);
		const clock = '2026-10-03T00:00:00.000Z';
		const original = kind === 'lease'
			? { schemaVersion: 'treeseed.lease/v1', id: 'lease', assignmentId: 'attempt', providerId: 'provider', state: 'active', acquiredAt: clock, expiresAt: clock, revision: 1 }
			: { schemaVersion: 'treeseed.reservation/v1', id: 'reservation', assignmentId: 'attempt', providerId: 'provider', workdayId: 'workday', estimatedSeconds: 1, state: 'held', reservedAt: clock };
		const retained = structuredClone(original), optional = kind === 'lease' ? 'releasedAt' : 'closedAt';
		for (const state of kind === 'lease' ? ['active', 'released', 'expired', 'revoked'] : ['held', 'consumed', 'released', 'expired']) {
			for (const input of [{ ...original, state }, { ...original, state, [optional]: clock }]) {
				const before = structuredClone(input); expect(schema.parse(input)).toEqual(input); expect(input).toEqual(before);
			}
		}
		for (const field of Object.keys(original)) {
			const absent = Object.fromEntries(Object.entries(original).filter(([key]) => key !== field));
			expect(schema.safeParse(absent).success, `absent ${field}`).toBe(false);
			for (const value of [undefined, null, '', [], {}]) {
				const input = { ...original, [field]: value }, before = structuredClone(input);
				expect(schema.safeParse(input).success, field).toBe(false); expect(input).toEqual(before);
			}
		}
		const numeric = kind === 'lease' ? 'revision' : 'estimatedSeconds';
		for (const value of ['1', true, 0, -1, 0.5, NaN, Infinity, -Infinity]) {
			const input = { ...original, [numeric]: value }, before = structuredClone(input);
			expect(schema.safeParse(input).success).toBe(false); expect(input).toEqual(before);
		}
		for (const field of kind === 'lease' ? ['id', 'assignmentId', 'providerId'] : ['id', 'assignmentId', 'providerId', 'workdayId']) {
			for (const value of [' padded ', 'a'.repeat(201), '!invalid']) expect(schema.safeParse({ ...original, [field]: value }).success).toBe(false);
			expect(schema.parse({ ...original, [field]: 'a'.repeat(200) })).toEqual({ ...original, [field]: 'a'.repeat(200) });
		}
		for (const field of kind === 'lease' ? ['acquiredAt', 'expiresAt', optional] : ['reservedAt', optional]) {
			for (const value of [null, '', '2026-99-03T00:00:00Z', '2026-10-03', 1]) expect(schema.safeParse({ ...original, [field]: value }).success).toBe(false);
			expect(schema.parse({ ...original, [field]: '2026-10-03T00:00:00+01:00' })).toEqual({ ...original, [field]: '2026-10-03T00:00:00+01:00' });
		}
		for (const patch of [{ state: 'unknown' }, { schemaVersion: 'legacy/v1' }, { token: 'forbidden' }, { leaseSeconds: 1 }, { legacy: true }]) {
			const input = { ...original, ...patch }, before = structuredClone(input);
			expect(schema.safeParse(input).success).toBe(false); expect(input).toEqual(before);
		}
		expect(original).toEqual(retained);
	}
	it('validates exact canonical lease states identifiers clocks and numeric boundaries without rewriting supplied records', () => verifyCanonicalRecord('lease'));
	it('validates exact canonical reservation states identifiers clocks and numeric boundaries without rewriting supplied records', () => verifyCanonicalRecord('reservation'));
	it('validates exact canonical settlement identities native units and clocks without normalizing supplied evidence', () => {
		const f = supplied(), original = { schemaVersion: 'treeseed.usage-settlement/v1', id: 'settlement', idempotencyKey: 'original-key',
			assignmentId: f.attempt.id, reservationId: f.attempt.reservationId, workdayId: f.attempt.workdayId,
			teamId: f.attempt.teamId, projectId: f.attempt.projectId, agentClass: f.attempt.agentClass,
			providerId: f.attempt.provider.providerId, actualSeconds: 2, nativeUsage: { input_tokens: 7, cpuSeconds: 0.125 }, settledAt: f.result.completedAt };
		const before = structuredClone(original); expect(usageSettlementSchema.parse(original)).toEqual(original);
		for (const field of Object.keys(original)) for (const value of [undefined, null, '', [], {}]) {
			const input = { ...original, [field]: value }, retained = structuredClone(input);
			// Empty native usage is valid for an explicitly measured zero-unit provider.
			if (field === 'nativeUsage' && value && typeof value === 'object' && !Array.isArray(value)) continue;
			expect(usageSettlementSchema.safeParse(input).success, field).toBe(false); expect(input).toEqual(retained);
		}
		for (const patch of [{ actualSeconds: '2' }, { actualSeconds: -1 }, { actualSeconds: 0.5 }, { actualSeconds: Infinity },
			{ nativeUsage: { tokens: '7' } }, { nativeUsage: { tokens: null } }, { nativeUsage: { tokens: NaN } },
			{ nativeUsage: { tokens: -1 } }, { nativeUsage: { provenance: 'execution-provider' } }, { settledAt: 'invalid' },
			{ agentClass: 'Named Role' }, { providerId: ' padded ' }, { cost: -1 }, { currency: 'usd' }, { legacy: true }]) {
			const input = { ...original, ...patch }, retained = structuredClone(input);
			expect(usageSettlementSchema.safeParse(input).success).toBe(false); expect(input).toEqual(retained);
		}
		expect(usageSettlementSchema.parse({ ...original, actualSeconds: 0, nativeUsage: {}, cost: 0.125, currency: 'USD' })).toEqual({
			...original, actualSeconds: 0, nativeUsage: {}, cost: 0.125, currency: 'USD' }); expect(original).toEqual(before);
	});
	it('retains a complete renamed canonical attempt and result without mutating public input', () => {
		const f = supplied(), before = structuredClone(f); expect(validateProviderAssignment(f.item)).toEqual({ ok: true, diagnostics: [] }); expect(f).toEqual(before);
		expect(f.item.projectAgentClassId).not.toBe(f.attempt.agentClass);
	});
	it('denies root identity provider class graph revision reservation and ordinal contradictions against the same frozen attempt', () => {
		const changes = [{ id: 'foreign' }, { teamId: 'foreign' }, { projectId: 'foreign' }, { workDayId: 'foreign' }, { capacityProviderId: 'foreign' },
			{ projectAgentClassId: 'foreign' }, { executionProviderId: 'foreign' }, { reservationId: 'foreign' }, { executionNodeId: 'foreign' }, { executionNodeRevision: 2 }, { graphRevision: 2 }, { attemptCount: 0 }, { attemptCount: 2 }];
		const outcomes = changes.map(change => { const f = supplied(); Object.assign(f.item, change); const before = structuredClone(f.item);
			const valid = validateProviderAssignment(f.item).ok; expect(f.item).toEqual(before); return valid; });
		expect(outcomes).toEqual(changes.map(() => false));
	});
	it('denies missing malformed or incomplete frozen attempts instead of certifying an executable public record', () => {
		const inputs = [undefined, null, [], {}, { schemaVersion: 'treeseed.assignment-attempt/v1', id: 'attempt' }];
		const outcomes = inputs.map(value => { const f = supplied(); f.item.assignmentAttempt = value; const before = structuredClone(f.item);
			const valid = validateProviderAssignment(f.item).ok; expect(f.item).toEqual(before); return valid; });
		expect(outcomes).toEqual(inputs.map(() => false));
	});
	it('denies missing malformed foreign or contradictory completed results while retaining the same original attempt', () => {
		const f = supplied(), inputs = [undefined, null, [], {}, { ...f.result, assignmentId: 'foreign' }, { ...f.result, status: 'failed' },
			{ ...f.result, completedAt: 'not-a-clock' }, { ...f.result, completedAt: '2026-10-02T23:59:59.999Z' },
			{ ...f.result, completedAt: '2026-10-03T00:00:02.001Z' },
			...[NaN, Infinity, -Infinity, -1, '1', null, true].map(value => ({ ...f.result, usage: { elapsedSeconds: 1, native: { providerUnit: value } } }))];
		const outcomes = inputs.map(value => { const item = structuredClone(f.item); item.assignmentResult = value; const before = structuredClone(item);
			const valid = validateProviderAssignment(item).ok; expect(item).toEqual(before); return valid; });
		expect(outcomes).toEqual(inputs.map(() => false));
		for (const attempt of [{ ...f.attempt, startedAt: '2026-10-03T00:00:01.001Z' },
			{ ...f.attempt, finishedAt: '2026-10-03T00:00:00.999Z' }]) {
			const item = { ...f.item, assignmentAttempt: attempt }, before = structuredClone(item);
			expect(validateProviderAssignment(item).ok).toBe(false); expect(item).toEqual(before);
		}
	});
});
