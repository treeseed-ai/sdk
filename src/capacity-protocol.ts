import { z } from 'zod';
import { CanonicalJson, PlatformSchemas } from './schemas.js';
import { SeedSchemas } from './seeds.js';
import { ActivitySchemas } from './activities.js';
import { EnvironmentSchemas } from './environments.js';
import {
  CapacitySchemas,
  CapacityContractBinding,
  CapacityContractError,
  type CapacityLease,
  type CapacityReadiness,
  type CapacityResult,
} from './capacity.js';

interface ReserveShape {
  expiresAtEpochMs: number;
  authority: { expiresAtEpochMs: number; state: string };
}
interface ReservationShape {
  request: { manager: unknown; expectedWorker: unknown };
  generations: { manager: unknown; worker: unknown };
}
interface DispatchShape {
  profileId: string;
  definition: { profiles: { id: string; environmentId: string }[] };
  environment: { id: string };
}
interface RunnerShape {
  state: string;
  output: string | null;
  blockers: unknown[];
}
class CapacityProtocolValidation {
  static reserve(value: ReserveShape): boolean {
    return (
      value.authority.state === 'granted' &&
      value.expiresAtEpochMs <= value.authority.expiresAtEpochMs
    );
  }
  static reservation(value: ReservationShape): boolean {
    return (
      CanonicalJson.stringify(value.request.manager) ===
        CanonicalJson.stringify(value.generations.manager) &&
      CanonicalJson.stringify(value.request.expectedWorker) ===
        CanonicalJson.stringify(value.generations.worker)
    );
  }
  static dispatch(value: DispatchShape): boolean {
    for (const profile of value.definition.profiles)
      if (profile.id === value.profileId) return profile.environmentId === value.environment.id;
    return false;
  }
  static runner(value: RunnerShape): boolean {
    if (value.state === 'completed') return value.output !== null && value.blockers.length === 0;
    if (value.output !== null) return false;
    return value.state === 'cancelled' || value.blockers.length > 0;
  }
}
/** Data contracts only. Authentication, isolation and live authority remain owner obligations. */
export class CapacityProtocolSchemas {
  static readonly version = '1.0.0-cordis.1';
  static readonly reserve = z
    .strictObject({
      schemaVersion: z.literal('treeseed.capacity-reserve/v1'),
      requestId: SeedSchemas.key,
      assignmentId: SeedSchemas.key,
      leaseId: SeedSchemas.key,
      scope: CapacitySchemas.scope,
      authority: CapacitySchemas.authority,
      manager: CapacitySchemas.process,
      expectedWorker: CapacitySchemas.process,
      compatibilityDigest: PlatformSchemas.digest,
      fence: CapacitySchemas.revision,
      expiresAtEpochMs: CapacitySchemas.clock,
    })
    .refine(CapacityProtocolValidation.reserve);
  static readonly reservation = z
    .strictObject({
      schemaVersion: z.literal('treeseed.capacity-reservation/v1'),
      id: SeedSchemas.key,
      request: this.reserve,
      sandboxId: SeedSchemas.key,
      inspectionDigest: PlatformSchemas.digest,
      generations: CapacitySchemas.generations,
    })
    .refine(CapacityProtocolValidation.reservation);
  static readonly dispatch = z
    .strictObject({
      schemaVersion: z.literal('treeseed.capacity-dispatch/v1'),
      reservationId: SeedSchemas.key,
      requestId: SeedSchemas.key,
      lease: CapacitySchemas.lease,
      definition: ActivitySchemas.definition,
      profileId: SeedSchemas.key,
      environment: EnvironmentSchemas.definition,
      input: z.string().max(2048),
    })
    .refine(CapacityProtocolValidation.dispatch);
  static readonly runnerOutcome = z
    .strictObject({
      schemaVersion: z.literal('treeseed.capacity-runner-outcome/v1'),
      lease: CapacitySchemas.lease,
      state: z.enum(['completed', 'cancelled', 'blocked']),
      output: z.string().max(1024).nullable(),
      blockers: z.array(CapacitySchemas.blocker).max(32),
    })
    .refine(CapacityProtocolValidation.runner);
}
export type CapacityReserveRequest = z.infer<typeof CapacityProtocolSchemas.reserve>;
export type CapacityReservation = z.infer<typeof CapacityProtocolSchemas.reservation>;
export type CapacityDispatch = z.infer<typeof CapacityProtocolSchemas.dispatch>;
export type CapacityRunnerOutcome = z.infer<typeof CapacityProtocolSchemas.runnerOutcome>;

export interface CapacityWorkerClient {
  ready(signal: AbortSignal): Promise<CapacityReadiness>;
  reserve(request: CapacityReserveRequest, signal: AbortSignal): Promise<CapacityReservation>;
  dispatch(request: CapacityDispatch, signal: AbortSignal): Promise<CapacityResult>;
  cancel(lease: CapacityLease, signal: AbortSignal): Promise<CapacityResult>;
}
export interface CapacityRunnerClient {
  ready(signal: AbortSignal): Promise<CapacityReadiness>;
  run(request: CapacityDispatch, signal: AbortSignal): Promise<CapacityRunnerOutcome>;
  cancel(lease: CapacityLease, signal: AbortSignal): Promise<CapacityRunnerOutcome>;
}
export class CapacityProtocolBinding {
  private static parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new CapacityContractError('INVALID_CAPACITY_CONTRACT');
    return parsed.data;
  }
  private static same(actual: unknown, expected: unknown): void {
    if (CanonicalJson.stringify(actual) !== CanonicalJson.stringify(expected))
      throw new CapacityContractError('STALE_CAPACITY_LEASE');
  }
  static assertDispatch(input: unknown, trusted: unknown, now: number): CapacityDispatch {
    const message = CapacityProtocolBinding.parse(CapacityProtocolSchemas.dispatch, input);
    const reservation = CapacityProtocolBinding.parse(CapacityProtocolSchemas.reservation, trusted);
    const request = reservation.request;
    CapacityProtocolBinding.same(message.reservationId, reservation.id);
    CapacityProtocolBinding.same(message.requestId, request.requestId);
    CapacityProtocolBinding.lease(message.lease, reservation);
    CapacityContractBinding.assertLease(
      message.lease,
      {
        lease: message.lease,
        authority: request.authority,
        generations: reservation.generations,
        fence: request.fence,
      },
      now,
    );
    return message;
  }
  private static lease(lease: CapacityLease, reservation: CapacityReservation): void {
    const request = reservation.request;
    CapacityProtocolBinding.same(lease.id, request.leaseId);
    CapacityProtocolBinding.same(lease.assignmentId, request.assignmentId);
    CapacityProtocolBinding.same(lease.sandboxId, reservation.sandboxId);
    CapacityProtocolBinding.same(lease.scope, request.scope);
    CapacityProtocolBinding.same(lease.compatibilityDigest, request.compatibilityDigest);
    CapacityProtocolBinding.same(lease.expiresAtEpochMs, request.expiresAtEpochMs);
  }
  static assertRunner(input: unknown, expected: unknown): CapacityRunnerOutcome {
    const outcome = CapacityProtocolBinding.parse(CapacityProtocolSchemas.runnerOutcome, input);
    const lease = CapacityProtocolBinding.parse(CapacitySchemas.lease, expected);
    CapacityProtocolBinding.same(outcome.lease, lease);
    return outcome;
  }
}
