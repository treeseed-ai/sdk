import { describe, expect, it } from 'vitest';
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
			{ ...f.result, completedAt: '2026-10-03T00:00:02.001Z' }];
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
