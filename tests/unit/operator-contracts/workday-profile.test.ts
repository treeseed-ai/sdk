import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKDAY_POLICY, workdayProfileSchema } from '../../../src/capacity/agents/agent-capacity.ts';
import { CONTROL_PLANE_OPERATIONS, controlPlaneOperation } from '../../../src/operator-contracts/index.ts';

describe('one team-owned workday policy contract', () => {
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
