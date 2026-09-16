import { describe, expect, it } from 'vitest';
import { allocateWorkdayCapacity, calculateAssignmentAllocation, calibrateAssignmentSeconds, distributeAllocationSeconds,
 type AllocationMeasurement } from '../../../../src/agent-capacity/contracts/capacity/workdays/assignment-allocation.ts';
import { compileWorkday } from '../../../../src/agent-capacity/contracts/capacity/workdays/workday-allocation.ts';

const estimate = { minimumSeconds: 60, expectedSeconds: 300, maximumSeconds: 600 };
const measurement = (overrides: Partial<AllocationMeasurement> = {}): AllocationMeasurement => ({
 id: 'a', completedAt: '2026-09-16T12:00:00Z', expectedSeconds: 300, allocatedSeconds: 600,
 activeSeconds: 100, outcome: 'completed', ...overrides,
});

describe('integrated assignment allocation arithmetic', () => {
 it('derives planning pools after weighted workday sharing and reclaims them at the boundary', () => {
  const workdays = ['production', 'simulation'].map((id, index) => ({
   plan: { ...compileWorkday({ id, teamId: 'team', policyId: 'default', policyRevision: 1,
    executionMode: index ? 'simulation' : 'production', policy: { durationSeconds: 1000, maximumConcurrency: 1,
     communicationConcurrency: 1, allocationWeight: index ? 1 : 2 }, agentIds: ['sdk/architect'],
    startsAt: '2026-09-16T12:00:00Z' }), state: 'active' as const },
   committedSeconds: 0, planningCommittedSeconds: 0, maximumAdditionalSeconds: 900,
  }));
  const planning = allocateWorkdayCapacity({ remainingSeconds: 900, now: '2026-09-16T12:00:00Z', workdays });
  expect(planning.production).toMatchObject({ shareSeconds: 600, availableSeconds: 120, phase: 'planning' });
  expect(planning.simulation).toMatchObject({ shareSeconds: 300, availableSeconds: 60 });
  const acting = allocateWorkdayCapacity({ remainingSeconds: 900, now: '2026-09-16T12:03:20Z', workdays });
  expect(acting.production).toMatchObject({ availableSeconds: 600, phase: 'acting' });
  expect(acting.simulation).toMatchObject({ availableSeconds: 300 });
  workdays[0]!.committedSeconds = 120; workdays[0]!.planningCommittedSeconds = 120;
  expect(allocateWorkdayCapacity({ remainingSeconds: 780, now: '2026-09-16T12:00:30Z', workdays }).production)
   .toMatchObject({ shareSeconds: 480, availableSeconds: 0 });
 });
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
