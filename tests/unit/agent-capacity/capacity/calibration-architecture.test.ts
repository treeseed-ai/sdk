import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { calculateAssignmentAllocation, calibrateAssignmentSeconds,
	type AllocationMeasurement } from '../../../../src/capacity/agents/agent-capacity.ts';

const estimate = { expectedSeconds: 300, maximumSeconds: 600 };
const sample = (id: string, seconds: number, overrides: Partial<AllocationMeasurement> = {}): AllocationMeasurement => ({
	id, completedAt: new Date(Date.parse('2026-10-02T12:00:00Z') + seconds * 1000).toISOString(),
	expectedSeconds: 300, allocatedSeconds: 600, activeSeconds: 100, outcome: 'completed', ...overrides,
});
type NativeCalibration = { result?: ReturnType<typeof calculateAssignmentAllocation>; error?: string };
function native(input: Parameters<typeof calculateAssignmentAllocation>[0] | { cases: Array<Parameters<typeof calculateAssignmentAllocation>[0]> }) {
	const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'),
		fileURLToPath(new URL('./calibration-native.ts', import.meta.url))], {
		input: JSON.stringify(input), encoding: 'utf8', timeout: 15_000,
	});
	expect(result.error).toBeUndefined();
	expect(result.status, result.stderr).toBe(0);
	return JSON.parse(result.stdout) as NativeCalibration & { cases?: NativeCalibration[] };
}

describe('architecture calibration eligibility and immutable hard limits', () => {
	it('replays the exact latest twenty eligible samples with stable ties and unchanged inputs', () => {
		const history = Array.from({ length: 23 }, (_, index) => sample(`sample-${String(index).padStart(2, '0')}`, index));
		history.push(sample('tie-a', 23), sample('tie-b', 23));
		const before = structuredClone(history);
		const result = calibrateAssignmentSeconds(estimate, history);
		expect(result.measurementIds).toEqual([...history.slice(5)].map(({ id }) => id));
		expect(calibrateAssignmentSeconds(estimate, [...history].reverse())).toEqual(result);
		expect(history).toEqual(before);
	});
	it('does not let newer cancellation credential infrastructure or invalid results displace eligible history', () => {
		const history = [sample('completed', 0), sample('expired', 1, { outcome: 'expired', activeSeconds: 600 })];
		const failures = (['cancelled', 'credential-failure', 'infrastructure-failure', 'invalid-result'] as const)
			.flatMap(outcome => Array.from({ length: 21 }, (_, index) => sample(`${outcome}-${index}`, index + 2, { outcome })));
		const input = [...history, ...failures], before = structuredClone(input);
		expect(calibrateAssignmentSeconds(estimate, input)).toEqual(calibrateAssignmentSeconds(estimate, history));
		expect(calibrateAssignmentSeconds(estimate, input)).toMatchObject({ seconds: 750, measurementIds: ['completed', 'expired'] });
		expect(input).toEqual(before);
	});
	it('denies malformed eligible timing and accounting rather than calibrating a usable deadline', () => {
		for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(() => calibrateAssignmentSeconds(estimate, [sample('invalid', 0, { activeSeconds: value })])).toThrow();
		}
		for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			for (const field of ['expectedSeconds', 'allocatedSeconds'] as const) {
				expect(() => calibrateAssignmentSeconds(estimate, [sample('invalid', 0, { [field]: value })])).toThrow();
			}
		}
		for (const completedAt of ['', 'not-a-clock']) {
			expect(() => calibrateAssignmentSeconds(estimate, [sample('invalid', 0, { completedAt })])).toThrow();
		}
		const observations: Array<{ field: string; denied: boolean }> = [];
		for (const field of ['id', 'completedAt', 'expectedSeconds', 'allocatedSeconds', 'activeSeconds']) {
			const values: unknown[] = [undefined, null, '', ' ', false, true, [], {}];
			if (field !== 'id') values.push('1');
			if (field === 'id') values.push(' padded-id ', 1);
			if (field === 'completedAt') values.push(0, 1, '2026-10-02', '0');
			for (const value of values) {
				const input = Object.assign(sample('original-sample', 0), { [field]: value }), before = structuredClone(input);
				let denied = false; try { calibrateAssignmentSeconds(estimate, [input]); } catch { denied = true; }
				observations.push({ field, denied }); expect(input).toEqual(before);
			}
		}
		for (const history of [[sample('same', 0), sample('same', 1)], [sample('same', 0), sample('same', 0)]]) {
			const before = structuredClone(history); let denied = false;
			try { calibrateAssignmentSeconds(estimate, history); } catch { denied = true; }
			observations.push({ field: 'duplicate', denied }); expect(history).toEqual(before);
		}
		expect(observations.every(value => value.denied), JSON.stringify(observations)).toBe(true);
		expect(() => calibrateAssignmentSeconds(estimate, [sample('1', 0)])).not.toThrow();
	});
	it('uses public SDK calibration without moving provider profile planning or supply ceilings', () => {
		const input = { estimate, measurements: [sample('expired', 0, { outcome: 'expired', activeSeconds: 600 })],
			providerMaximumSeconds: 500, profileMaximumSeconds: 450, planningTurnMaximumSeconds: 180,
			constraints: [{ id: 'shared-model', remainingSeconds: 120 }, { id: 'capability', remainingSeconds: 150 }] };
		const before = structuredClone(input), output = native(input);
		expect(output.error).toBeUndefined();
		expect(output.result).toMatchObject({ admitted: true, desiredSeconds: 750, allocatedSeconds: 120,
			limitingConstraint: 'shared-model', calibration: { measurementIds: ['expired'] } });
		expect(input).toEqual(before);
	});
	it('defers exhausted or malformed supply through the independent public SDK boundary', () => {
		const input = { estimate, measurements: [], constraints: [{ id: 'shared-model', remainingSeconds: 0 }] };
		expect(native(input).result).toMatchObject({ admitted: false, allocatedSeconds: 0, desiredSeconds: 600 });
		expect(native({ ...input, constraints: [] }).error).toBeDefined();
		expect(native({ ...input, constraints: [{ id: 'shared-model', remainingSeconds: -1 }] }).error).toBeDefined();
		const cases: Array<Parameters<typeof calculateAssignmentAllocation>[0]> = [];
		for (const field of ['id', 'completedAt', 'expectedSeconds', 'allocatedSeconds', 'activeSeconds']) {
			const values: unknown[] = [undefined, null, '', ' ', false, true, [], {}];
			if (field !== 'id') values.push('1');
			if (field === 'id') values.push(' padded-id ', 1);
			if (field === 'completedAt') values.push(0, 1, '2026-10-02', '0');
			for (const value of values) {
				cases.push({ estimate, measurements: [Object.assign(sample('original-sample', 0), { [field]: value })],
					constraints: [{ id: 'original-hard-limit', remainingSeconds: 600 }] });
			}
		}
		cases.push({ estimate, measurements: [sample('same', 0), sample('same', 1)],
			constraints: [{ id: 'original-hard-limit', remainingSeconds: 600 }] });
		const before = structuredClone(cases), output = native({ cases }); expect(cases).toEqual(before);
		expect(output.cases).toHaveLength(cases.length);
		expect(output.cases!.every(value => typeof value.error === 'string' && value.error.length > 0), JSON.stringify(output.cases)).toBe(true);
		expect(native({ estimate, measurements: [sample('1', 0)], constraints: [{ id: 'original-hard-limit', remainingSeconds: 600 }] }).error).toBeUndefined();
	});
});
