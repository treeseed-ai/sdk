import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKDAY_POLICY, workdayPolicySchema, workdayProfileSchema } from '../../../src/capacity/agents/agent-capacity.ts';
import { CONTROL_PLANE_OPERATIONS, controlPlaneOperation } from '../../../src/operator-contracts/index.ts';

describe('one team-owned workday policy contract', () => {
	it('requires every stored policy field without inserting defaults or rewriting exact supplied policy snapshots', () => {
		const policy = structuredClone(DEFAULT_WORKDAY_POLICY), held = structuredClone(policy);
		const fields = ['durationSeconds', 'maximumConcurrency', 'planningPercent', 'allocationWeight',
			'planningTurnMaximumSeconds', 'communicationConcurrency', 'projectPercentages', 'agentClassPercentages'];
		expect(Object.keys(policy).sort()).toEqual([...fields].sort()); expect(workdayPolicySchema.parse(policy)).toEqual(policy);
		const admitted: string[] = [];
		for (const field of fields) {
			const missing = Object.fromEntries(Object.entries(policy).filter(([key]) => key !== field));
			const supplied = { id: 'default', teamId: 'team', revision: 1, policy: missing }, before = structuredClone(supplied);
			if (workdayProfileSchema.safeParse(supplied).success) admitted.push(field);
			expect(supplied).toEqual(before);
			for (const value of [undefined, null, '', false, []]) {
				const malformed = { ...policy, [field]: value }, frozen = structuredClone(malformed);
				expect(workdayPolicySchema.safeParse(malformed).success).toBe(false); expect(malformed).toEqual(frozen);
			}
		}
		expect(admitted).toEqual([]); expect(policy).toEqual(held);
		expect(workdayProfileSchema.parse({ id: 'default', teamId: 'team', revision: 1, policy })).toEqual({
			id: 'default', teamId: 'team', revision: 1, policy,
		});
	});
	it('uses the allocation policy without repository tiers or borrowing', () => {
		expect(workdayProfileSchema.parse({ id: 'default', teamId: 'team', revision: 1, policy: DEFAULT_WORKDAY_POLICY }))
			.toMatchObject({ policy: { planningPercent: 20, allocationWeight: 1, planningTurnMaximumSeconds: 180,
				projectPercentages: {}, agentClassPercentages: {} } });
		for (const field of ['classes', 'borrowingRules', 'reservePercent', 'planningSecondsPerAgent']) {
			expect(workdayProfileSchema.safeParse({ id: 'default', teamId: 'team', revision: 1,
				policy: { ...DEFAULT_WORKDAY_POLICY, [field]: [] } }).success).toBe(false);
		}
	});
	it('requires normal concurrency and idempotency for policy replacement', () => {
		const update = CONTROL_PLANE_OPERATIONS.workdays.profilesUpdate;
		expect(update.descriptor.concurrency.required).toBe(true);
		expect(update.descriptor.idempotency.required).toBe(true);
		expect(update.schema.body.safeParse({ policy: DEFAULT_WORKDAY_POLICY }).success).toBe(true);
		expect(() => controlPlaneOperation('workdays.profiles.reconcile')).toThrow();
	});
});
