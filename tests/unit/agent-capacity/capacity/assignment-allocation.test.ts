import { describe, expect, it } from 'vitest';
import { calculateAssignmentAllocation, calibrateAssignmentSeconds, distributeAllocationSeconds,
 type AllocationMeasurement } from '../../../../src/agent-capacity/contracts/capacity/workdays/assignment-allocation.ts';

const estimate = { minimumSeconds: 60, expectedSeconds: 300, maximumSeconds: 600 };
const measurement = (overrides: Partial<AllocationMeasurement> = {}): AllocationMeasurement => ({
 id: 'a', completedAt: '2026-09-16T12:00:00Z', expectedSeconds: 300, allocatedSeconds: 600,
 activeSeconds: 100, outcome: 'completed', ...overrides,
});

describe('integrated assignment allocation arithmetic', () => {
 it('shares capacity across concurrent production/simulation workdays by weight', () => {
  expect(distributeAllocationSeconds(800, [
   { id: 'production', weight: 2, committedSeconds: 0, maximumAdditionalSeconds: 800 },
   { id: 'simulation', weight: 1, committedSeconds: 0, maximumAdditionalSeconds: 800 },
  ])).toEqual({ production: 533, simulation: 267 });
 });
 it('preserves committed entitlement and redistributes idle demand', () => {
  expect(distributeAllocationSeconds(600, [
   { id: 'a', weight: 1, committedSeconds: 400, maximumAdditionalSeconds: 600 },
   { id: 'b', weight: 1, committedSeconds: 0, maximumAdditionalSeconds: 600 },
  ])).toEqual({ a: 100, b: 500 });
  expect(distributeAllocationSeconds(600, [
   { id: 'a', weight: 1, committedSeconds: 0, maximumAdditionalSeconds: 0 },
   { id: 'b', weight: 1, committedSeconds: 0, maximumAdditionalSeconds: 600 },
  ])).toEqual({ a: 0, b: 600 });
 });
 it('is independent of input ordering and never overallocates integer seconds', () => {
  const shares = ['a', 'b', 'c'].map((id) => ({ id, weight: 1, committedSeconds: 0, maximumAdditionalSeconds: 100 }));
  const result = distributeAllocationSeconds(7, shares);
  expect(distributeAllocationSeconds(7, shares.reverse())).toEqual(result);
  expect(Object.values(result).reduce((sum, value) => sum + value, 0)).toBe(7);
 });
 it('starts conservatively, reduces gradually, and treats expiration as censored', () => {
  expect(calibrateAssignmentSeconds(estimate, []).seconds).toBe(600);
  expect(calibrateAssignmentSeconds(estimate, [measurement()]).seconds).toBe(540);
  expect(calibrateAssignmentSeconds(estimate, [measurement({ outcome: 'expired', activeSeconds: 600 })]).seconds).toBe(750);
  expect(calibrateAssignmentSeconds(estimate, [measurement({ outcome: 'infrastructure-failure' })]).seconds).toBe(600);
 });
 it('normalizes task complexity and uses only the latest twenty eligible samples', () => {
  const history = Array.from({ length: 21 }, (_, index) => measurement({ id: String(index).padStart(2, '0'),
   completedAt: new Date(Date.parse('2026-09-16T12:00:00Z') + index * 1000).toISOString() }));
  expect(calibrateAssignmentSeconds(estimate, history).measurementIds).toHaveLength(20);
  expect(calibrateAssignmentSeconds({ expectedSeconds: 600, maximumSeconds: 1200 }, [measurement()]).seconds).toBe(1080);
 });
 it('checks both capability and shared model ceilings without charging additional requirements twice', () => {
  const result = calculateAssignmentAllocation({ estimate, measurements: [], constraints: [
   { id: 'capability-research', remainingSeconds: 3600 }, { id: 'model-astra', remainingSeconds: 120 },
   { id: 'workday', remainingSeconds: 800 },
  ] });
  expect(result).toMatchObject({ admitted: true, allocatedSeconds: 120, limitingConstraint: 'model-astra' });
 });
 it('defers below viable minimum and obeys provider bounds and planning turn ceilings', () => {
  expect(calculateAssignmentAllocation({ estimate, measurements: [], constraints: [{ id: 'capability', remainingSeconds: 59 }] }))
   .toMatchObject({ admitted: false, allocatedSeconds: 0 });
  expect(calculateAssignmentAllocation({ estimate, measurements: [], planningTurnMaximumSeconds: 180,
   providerMaximumSeconds: 120, constraints: [{ id: 'phase', remainingSeconds: 300 }] })).toMatchObject({ allocatedSeconds: 120 });
  expect(calculateAssignmentAllocation({ estimate, measurements: [], planningTurnMaximumSeconds: 180,
   providerMinimumSeconds: 240, constraints: [{ id: 'phase', remainingSeconds: 300 }] })).toMatchObject({ admitted: false });
 });
 it('rejects malformed accounting rather than advertising usable supply', () => {
  expect(() => distributeAllocationSeconds(-1, [])).toThrow('allocation_amount_invalid');
  expect(() => calibrateAssignmentSeconds(estimate, [measurement({ activeSeconds: Number.NaN })])).toThrow('allocation_amount_invalid');
 });
});
