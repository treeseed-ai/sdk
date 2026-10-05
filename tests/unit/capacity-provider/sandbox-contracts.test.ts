import { describe, expect, it } from 'vitest';
import { assignmentTimingAwarenessReceiptSchema } from '../../../src/capacity-provider/sandbox-contracts.ts';

const receipt = () => ({
	schemaVersion: 'treeseed.assignment-timing-awareness/v1',
	requiredChecks: 2,
	completedChecks: 2,
	firstTool: 'treedx:treeseed_time_status',
	firstToolSucceeded: true,
	lastTool: 'treedx:treeseed_time_status',
	lastToolSucceeded: true,
	firstToolCompliant: true,
	finalToolCompliant: true,
});

describe('assignment timing-awareness receipt', () => {
	it('accepts exactly two successful clock checks bracketing all attempted tool actions', () => {
		expect(assignmentTimingAwarenessReceiptSchema.parse(receipt())).toEqual(receipt());
	});

	it.each([
		['missing initial boundary', { firstToolCompliant: false }],
		['failed final boundary', { lastToolSucceeded: false }],
		['aliased clock', { firstTool: 'treedx:time_status' }],
	])('rejects %s', (_name, change) => {
		expect(assignmentTimingAwarenessReceiptSchema.safeParse({ ...receipt(), ...change }).success).toBe(false);
	});

	it('allows additional successful clock checks during longer work', () => {
		expect(assignmentTimingAwarenessReceiptSchema.safeParse({ ...receipt(), completedChecks: 3 }).success).toBe(true);
	});
});
