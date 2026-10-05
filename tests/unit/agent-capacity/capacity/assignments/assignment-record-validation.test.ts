import { describe, expect, it } from 'vitest';
import { validateProviderAssignment } from '../../../../../src/agent-capacity/validation/assignment-records.ts';
import { assignmentAttemptSchema, assignmentResultSchema, exactGrantSchema } from '../../../../../src/agent-capacity/contracts/capacity/assignments/agent-execution.ts';

function assignment(overrides: Record<string, unknown> = {}) {
	const at = '2026-07-18T00:00:00.000Z', ref = { store: 'treedx', model: 'agent', id: 'configured-builder',
		repository: 'team-library', commit: 'a'.repeat(40), path: 'agents/configured-builder.yaml' };
	const attempt = assignmentAttemptSchema.parse({ schemaVersion: 'treeseed.assignment-attempt/v1', id: 'assignment-a',
		idempotencyKey: 'assignment-a', teamId: 'team-a', projectId: 'project-a', workdayId: 'workday-a', nodeId: 'node-a',
		nodeRevision: 1, graphRevision: 1, agentClass: 'configured-builder', sourceRef: ref, authorityRefs: [ref],
		effectiveProfile: { profileRef: ref, activity: 'planning', handler: 'writer', handlerOrigin: 'agent-package',
			prompt: { system: 'Plan only the supplied authorized work.' }, permissionCeiling: { content: { read: ['agent'], write: [] }, tools: [] } },
		requiredCapabilities: [], grant: { contentRead: [ref], contentWrite: [], sourceRead: [], sourceWrite: [], tools: [] },
		provider: { providerId: 'provider-a', offerId: 'offer-a', offerRevision: 1, executionProviderId: 'executor-a',
			modelConfigurationId: 'model-a', executionCapabilityId: 'capability-a', runtimeBuild: `sha256:${'b'.repeat(64)}` },
		contextRefs: [ref], predecessorResultIds: [], workspace: { mode: 'read-only' }, estimate: { expectedSeconds: 1, maximumSeconds: 2 },
		limits: { maximumSeconds: 2, maximumContextBytes: 1024, maximumContextItems: 1 }, deadline: '2026-07-18T00:00:02.000Z',
		leaseId: 'lease-a', reservationId: 'reservation-a', attempt: 1, status: 'created', createdAt: at });
	return {
		id: 'assignment-a', membershipId: 'membership-a', stateVersion: 1, teamId: 'team-a', projectId: 'project-a',
		capacityProviderId: 'provider-a', providerSessionId: null, executionProviderId: 'executor-a', laneId: null,
		projectAgentClassId: 'class-a', reservationId: 'reservation-a',
		workDayId: 'workday-a', taskId: 'task-a', mode: 'planning', status: 'pending', leaseState: 'unleased',
		leaseExpiresAt: null, leaseToken: null, leaseRenewedAt: null, runnerId: null, agentId: 'agent-a', handlerId: 'writer',
		capacityEnvelope: { teamId: 'team-a', projectId: 'project-a', mode: 'planning', workDayId: 'workday-a',
			projectAgentClassId: 'class-a', capacityProviderId: 'provider-a', executionProviderId: 'executor-a', reservationId: 'reservation-a' },
		workspaceContext: {}, allowedOutputs: {}, explanation: {}, attemptCount: 1, assignmentAttempt: attempt,
		executionNodeId: attempt.nodeId, executionNodeRevision: attempt.nodeRevision, graphRevision: attempt.graphRevision,
		assignedAt: null, claimedAt: null, completedAt: null, returnedAt: null, failedAt: null, lifecycleReason: null,
		lifecycleCode: null, lifecycleOutput: {}, synthesizedFrom: 'living_execution_graph', synthesisKey: 'synthesis-a', decisionId: null,
		proposalId: null, fallbackOutputId: null, treedxProxyHandle: null, capabilityHandles: null, metadata: {},
		createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z', ...overrides,
	};
}

describe('assignment record validation', () => {
	it('retains every canonical tool group and rejects undeclared malformed or duplicate grant tools without changing caller bytes', () => {
		const grant = assignment().assignmentAttempt.grant;
		const valid = ['discussion', 'source.read', 'source.write', 'verification', 'release'];
		for (const tools of [[], valid, ...valid.map(tool => [tool])]) {
			const input = { ...grant, tools }, held = structuredClone(input);
			expect(exactGrantSchema.parse(input)).toEqual(input); expect(input).toEqual(held);
		}
		const outcomes = [];
		for (const tools of [['invented-authority'], ['source.read', 'invented-authority'], ['source.read', 'source.read'], [''], [' '], [null], [1], null, 'source.read']) {
			const input = { ...grant, tools }, held = structuredClone(input);
			outcomes.push(exactGrantSchema.safeParse(input).success); expect(input).toEqual(held);
		}
		expect(outcomes).toEqual(Array(9).fill(false));
	});
	it('retains distinct canonical reference inventories and rejects exact duplicate authority context grants and result references without normalization', () => {
		const original = assignment().assignmentAttempt, first = original.authorityRefs[0]!, second = { ...first, id: 'second-evidence' };
		const observed: Array<{ field: string; distinct: boolean; duplicated: boolean }> = [];
		for (const field of ['authorityRefs', 'contextRefs'] as const) {
			const valid = { ...original, [field]: [first, second] }, invalid = { ...original, [field]: [first, structuredClone(first)] };
			const held = structuredClone({ valid, invalid });
			observed.push({ field, distinct: assignmentAttemptSchema.safeParse(valid).success, duplicated: assignmentAttemptSchema.safeParse(invalid).success });
			expect({ valid, invalid }).toEqual(held);
		}
		for (const field of ['contentRead', 'contentWrite'] as const) {
			const valid = { ...original.grant, [field]: [first, second] }, invalid = { ...original.grant, [field]: [first, structuredClone(first)] };
			const held = structuredClone({ valid, invalid });
			observed.push({ field, distinct: exactGrantSchema.safeParse(valid).success, duplicated: exactGrantSchema.safeParse(invalid).success });
			expect({ valid, invalid }).toEqual(held);
		}
		const reference = { kind: 'url', url: 'https://example.test/one' }, other = { kind: 'url', url: 'https://example.test/two' };
		const result = { schemaVersion: 'treeseed.assignment-result/v1', id: 'result', assignmentId: original.id, status: 'completed',
			summary: 'Supplied parser input, not provider evidence.', references: [reference, other], verification: [],
			usage: { elapsedSeconds: 1 }, diagnostics: [], completedAt: original.createdAt };
		const invalid = { ...result, references: [reference, { url: reference.url, kind: reference.kind }] }, held = structuredClone({ result, invalid });
		observed.push({ field: 'references', distinct: assignmentResultSchema.safeParse(result).success, duplicated: assignmentResultSchema.safeParse(invalid).success });
		expect({ result, invalid }).toEqual(held);
		expect(observed).toEqual(['authorityRefs', 'contextRefs', 'contentRead', 'contentWrite', 'references']
			.map(field => ({ field, distinct: true, duplicated: false })));
	});
	it('accepts complete canonical durable records', () => {
		expect(validateProviderAssignment(assignment())).toEqual({ ok: true, diagnostics: [] });
		expect(validateProviderAssignment(assignment({ assignmentAttempt: null })).ok).toBe(false);
		expect(validateProviderAssignment(assignment({ decisionInput: {} })).diagnostics.map((entry) => entry.code))
			.toContain('provider_assignment_retired_input');
		expect(validateProviderAssignment(assignment({ synthesizedFrom: 'living_execution_graph' }))).toEqual({ ok: true, diagnostics: [] });
	});

	it('rejects widened statuses, missing governance provenance, and invalid timestamps', () => {
		for (const retired of ['approved_decision', 'planning_input_request', 'capacity_plan', 'workday_demand', 'verification_failure', 'fallback_queue']) {
			expect(validateProviderAssignment(assignment({ synthesizedFrom: retired })).diagnostics.map((entry) => entry.code))
				.toContain('provider_assignment_synthesis_source_invalid');
		}
		expect(validateProviderAssignment(assignment({ membershipId: '', status: 'abandoned', stateVersion: 0 })).diagnostics.map((entry) => entry.code))
			.toEqual(expect.arrayContaining(['provider_assignment_field_invalid', 'provider_assignment_status_invalid', 'provider_assignment_state_version_invalid']));
	});

	it('rejects retired allocation-set provenance', () => {
		expect(validateProviderAssignment(assignment({ allocationSetId: 'retired' })).diagnostics)
			.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'provider_assignment_retired_allocation' })]));
	});
});
