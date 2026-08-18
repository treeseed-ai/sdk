import { describe, expect, it } from 'vitest';
import { evaluateMinimumAssignmentDuration } from '../../../../../src/capacity-provider/timing/assignment-duration.ts';

describe('minimum assignment duration', () => {
	it('evaluates an elapsed minimum from the exact assignment start', () => {
		expect(evaluateMinimumAssignmentDuration({ amount: 600, unit: 'seconds' }, '2026-08-14T12:00:00.000Z')).toMatchObject({
			minimumDeadlineAt: '2026-08-14T12:10:00.000Z', minimumWindowSeconds: 600,
		});
	});

	it('skips weekends and declared holidays while preserving local wall time', () => {
		const result = evaluateMinimumAssignmentDuration({
			amount: 5, unit: 'business-days',
			calendar: { timeZone: 'America/New_York', holidayDates: ['2026-08-17'] },
		}, '2026-08-14T16:00:00.000Z');
		expect(result.minimumDeadlineAt).toBe('2026-08-24T16:00:00.000Z');
		expect(result.minimumWindowSeconds).toBe(10 * 86_400);
	});
});
