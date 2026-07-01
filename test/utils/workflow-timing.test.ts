import { describe, expect, it } from 'vitest';
import { createTreeseedWorkflowTimer, formatTreeseedDuration, slowestTreeseedWorkflowPhases } from '../../src/operations/services/workflow-timing.ts';

describe('workflow timing', () => {
	it('records passed, failed, and skipped phases', () => {
		const timer = createTreeseedWorkflowTimer('2026-01-01T00:00:00.000Z');
		expect(timer.phase('passed', 'Passed phase', () => 'ok')).toBe('ok');
		expect(() => timer.phase('failed', 'Failed phase', () => {
			throw new Error('boom');
		})).toThrow('boom');
		timer.skip('skipped', 'Skipped phase');

		const timing = timer.finish();
		expect(timing.startedAt).toBe('2026-01-01T00:00:00.000Z');
		expect(timing.finishedAt).toBeTruthy();
		expect(timing.phases.map((phase) => phase.status)).toEqual(['passed', 'failed', 'skipped']);
	});

	it('sorts slowest phases and formats durations', () => {
		const timing = {
			startedAt: '2026-01-01T00:00:00.000Z',
			finishedAt: '2026-01-01T00:00:04.000Z',
			durationMs: 4000,
			phases: [
				{ id: 'short', label: 'Short', startedAt: 'a', finishedAt: 'b', durationMs: 1000, status: 'passed' as const },
				{ id: 'long', label: 'Long', startedAt: 'a', finishedAt: 'b', durationMs: 125000, status: 'passed' as const },
			],
		};
		expect(slowestTreeseedWorkflowPhases(timing, 1)[0]?.id).toBe('long');
		expect(formatTreeseedDuration(125000)).toBe('2m5s');
	});
});
