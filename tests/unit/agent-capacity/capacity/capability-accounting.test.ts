import { describe, expect, it } from 'vitest';
import { capabilityAccountingLimitsSchema, remainingCapabilitySeconds } from '../../../../src/agent-capacity/contracts/capacity/workdays/capability-accounting.ts';

const input = { now: '2026-09-16T12:00:00Z', maximumObservationAgeSeconds: 90,
 dailyLimitSeconds: 3600, ledgerActiveSeconds: 100, ledgerReservedSeconds: 200,
 observation: { day: '2026-09-16', observedAt: '2026-09-16T11:59:59Z', healthy: true, activeSeconds: 100, reservedSeconds: 200 } };

describe('capability daily accounting', () => {
 it('requires explicit shared-model and capability caps and valid assignment bounds', () => {
  const limits = { modelConfigurationId: 'codex-terra', dailyActiveSecondsLimit: 28800,
   capabilityLimits: { implementation: { dailyActiveSecondsLimit: 28800, minimumAssignmentSeconds: 60, maximumAssignmentSeconds: 3600 } } };
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
