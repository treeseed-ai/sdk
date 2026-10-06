import { describe, expect, it } from 'vitest';
import { capabilityAccountingLimitsSchema, remainingCapabilitySeconds } from '../../../../src/agent-capacity/contracts/capacity/workdays/capability-accounting.ts';

const input = { now: '2026-09-16T12:00:00Z', maximumObservationAgeSeconds: 90,
 dailyLimitSeconds: 3600, ledgerActiveSeconds: 100, ledgerReservedSeconds: 200,
 observation: { day: '2026-09-16', observedAt: '2026-09-16T11:59:59Z', healthy: true, activeSeconds: 100, reservedSeconds: 200 } };

describe('capability daily accounting', () => {
 it('rejects malformed retained observation fields before a new report can hide them behind unhealthy or fresh supply', () => {
  const previous = { ...input.observation }, mutations: Array<Record<string, unknown>> = [];
  for (const reservedSeconds of [undefined, null, '0', false, -1, NaN, Infinity, -Infinity]) mutations.push({ reservedSeconds });
  for (const healthy of [undefined, null, 'true', 0, 1, [], {}]) mutations.push({ healthy });
  for (const day of [undefined, null, '', 'not-a-day', '2026-02-30', '2026-09-15', 20260916]) mutations.push({ day });
  for (const observedAt of [undefined, null, '', 'not-a-clock', 0]) mutations.push({ observedAt });
  for (const patch of mutations) for (const healthy of [true, false]) {
   const supplied = { ...structuredClone(input), observation: { ...input.observation, healthy },
    previousObservation: Object.assign({}, previous, patch) }, before = structuredClone(supplied);
   expect(() => remainingCapabilitySeconds(supplied)).toThrow('capability_accounting_invalid'); expect(supplied).toEqual(before);
  }
  for (const healthy of [true, false]) {
   const supplied = { ...structuredClone(input), previousObservation: { ...previous, healthy } }, before = structuredClone(supplied);
   expect(remainingCapabilitySeconds(supplied)).toEqual({ availableSeconds: 3300, reason: 'accounted', activeSeconds: 100,
    reservedSeconds: 200, day: '2026-09-16' }); expect(supplied).toEqual(before);
  }
 });
 it('rejects every nonboolean observation health value without coercing supply or rewriting original accounting evidence', () => {
  for (const value of [undefined, null, '', 'true', 'false', 0, 1, [], {}, ['true']]) {
   const supplied = { ...structuredClone(input), observation: Object.assign({}, input.observation, { healthy: value }) };
   const before = structuredClone(supplied);
   expect(() => remainingCapabilitySeconds(supplied)).toThrow('capability_accounting_invalid'); expect(supplied).toEqual(before);
  }
  for (const healthy of [true, false]) {
   const supplied = { ...structuredClone(input), observation: { ...input.observation, healthy } }, before = structuredClone(supplied);
   expect(remainingCapabilitySeconds(supplied)).toEqual(healthy
    ? { availableSeconds: 3300, reason: 'accounted', activeSeconds: 100, reservedSeconds: 200, day: '2026-09-16' }
    : { availableSeconds: 0, reason: 'unhealthy' }); expect(supplied).toEqual(before);
  }
 });
 it('retains exact fractional measured supply and applies the stricter independent ledger without rounding native observations upward', () => {
  const supplied = { ...structuredClone(input), dailyLimitSeconds: 400.75, ledgerActiveSeconds: 100.125, ledgerReservedSeconds: 200.5,
   observation: { ...input.observation, activeSeconds: 99.75, reservedSeconds: 200.25 } }, before = structuredClone(supplied);
  expect(remainingCapabilitySeconds(supplied)).toEqual({ availableSeconds: 100, reason: 'accounted', activeSeconds: 100.125,
   reservedSeconds: 200.5, day: '2026-09-16' }); expect(supplied).toEqual(before);
  expect(remainingCapabilitySeconds({ ...supplied, dailyLimitSeconds: 300.625 })).toEqual({ availableSeconds: 0,
   reason: 'accounted', activeSeconds: 100.125, reservedSeconds: 200.5, day: '2026-09-16' });
 });
 it('requires explicit shared-model and capability caps without assignment minimums', () => {
  const limits = { modelConfigurationId: 'codex-terra', dailyActiveSecondsLimit: 28800,
   capabilityLimits: { implementation: { dailyActiveSecondsLimit: 28800, maximumAssignmentSeconds: 3600 } } };
  expect(capabilityAccountingLimitsSchema.safeParse(limits).success).toBe(true);
  expect(capabilityAccountingLimitsSchema.safeParse({}).success).toBe(false);
  expect(capabilityAccountingLimitsSchema.safeParse({ ...limits, capabilityLimits: {} }).success).toBe(false);
  expect(capabilityAccountingLimitsSchema.safeParse({ ...limits, capabilityLimits: { implementation: {
   dailyActiveSecondsLimit: 3600, minimumAssignmentSeconds: 120, maximumAssignmentSeconds: 60 } } }).success).toBe(false);
 });
 it('does not double count reports and uses authoritative outstanding reservations', () => {
  expect(remainingCapabilitySeconds(input)).toMatchObject({ availableSeconds: 3300 });
  expect(remainingCapabilitySeconds({ ...input, ledgerReservedSeconds: 400 })).toMatchObject({ availableSeconds: 3100 });
 });
 it('denies stale, unhealthy, future, and decreasing usage', () => {
  expect(remainingCapabilitySeconds({ ...input, observation: { ...input.observation, healthy: false } }).availableSeconds).toBe(0);
  expect(remainingCapabilitySeconds({ ...input, observation: { ...input.observation, observedAt: '2026-09-16T11:00:00Z' } }).reason).toBe('stale');
  expect(remainingCapabilitySeconds({ ...input, observation: { ...input.observation, observedAt: '2026-09-16T12:01:00Z' } }).reason).toBe('stale');
  expect(remainingCapabilitySeconds({ ...input, previousObservation: { ...input.observation, activeSeconds: 101 } }).reason).toBe('non-monotonic');
  expect(remainingCapabilitySeconds({ ...input, observation: { ...input.observation, healthy: false },
   previousObservation: { ...input.observation, activeSeconds: 101 } }).reason).toBe('non-monotonic');
 });
 it('requires a fresh report at UTC rollover and fails closed on exhausted supply', () => {
  expect(remainingCapabilitySeconds({ ...input, now: '2026-09-17T00:00:00Z' }).reason).toBe('stale');
  expect(remainingCapabilitySeconds({ ...input, dailyLimitSeconds: 100 }).availableSeconds).toBe(0);
 });
 it('rejects malformed accounting', () => {
  expect(() => remainingCapabilitySeconds({ ...input, ledgerActiveSeconds: Number.NaN })).toThrow('capability_accounting_invalid');
 });
});
