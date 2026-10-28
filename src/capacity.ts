import { z } from 'zod';
import { CanonicalJson, PlatformSchemas } from './schemas.js';
import { SeedSchemas } from './seeds.js';

export type CapacityContractCode =
  | 'INVALID_CAPACITY_CONTRACT'
  | 'CAPACITY_GRANT_REVOKED'
  | 'CAPACITY_GRANT_EXPIRED'
  | 'CAPACITY_SCOPE_MISMATCH'
  | 'CAPACITY_LEASE_EXPIRED'
  | 'STALE_CAPACITY_GENERATION'
  | 'STALE_CAPACITY_LEASE'
  | 'CAPACITY_TARGET_UNREADY'
  | 'CAPACITY_CAPABILITY_DENIED'
  | 'CAPACITY_CANCELLED'
  | 'CAPACITY_HANDLER_FAILED'
  | 'CAPACITY_CLEANUP_FAILED';

interface LeaseShape {
  expiresAtEpochMs: number;
  authority: { state: string; expiresAtEpochMs: number };
}
interface ResultShape {
  lease: { sandboxId: string; generations: { sandbox: string } };
  state: string;
  output: string | null;
  blockers: unknown[];
  cleanup: {
    sandboxId: string;
    providerGeneration: string;
    disposition: string;
    inspectionDigest: string | null;
  };
}

class CapacityValidation {
  static readonly messages: Record<CapacityContractCode, string> = {
    INVALID_CAPACITY_CONTRACT: 'The capacity contract is invalid.',
    CAPACITY_GRANT_REVOKED: 'The capacity grant is revoked.',
    CAPACITY_GRANT_EXPIRED: 'The capacity grant has expired.',
    CAPACITY_SCOPE_MISMATCH: 'The capacity authority or scope does not match.',
    CAPACITY_LEASE_EXPIRED: 'The capacity lease has expired.',
    STALE_CAPACITY_GENERATION: 'The capacity process or provider generation is stale.',
    STALE_CAPACITY_LEASE: 'The capacity lease or fence is stale.',
    CAPACITY_TARGET_UNREADY: 'The capacity target is not ready.',
    CAPACITY_CAPABILITY_DENIED: 'The capacity operation is not granted.',
    CAPACITY_CANCELLED: 'The capacity probe was cancelled.',
    CAPACITY_HANDLER_FAILED: 'The capacity probe handler failed.',
    CAPACITY_CLEANUP_FAILED: 'The assigned sandbox cleanup failed.',
  };

  static issuer(value: string): boolean {
    try {
      const issuer = new URL(value);
      return (
        issuer.protocol === 'https:' &&
        !issuer.username &&
        !issuer.password &&
        !issuer.search &&
        !issuer.hash
      );
    } catch {
      return false;
    }
  }

  static capabilities(values: string[]): string[] {
    return [...values].sort();
  }

  static lease(value: LeaseShape): boolean {
    return (
      value.authority.state === 'granted' &&
      value.expiresAtEpochMs <= value.authority.expiresAtEpochMs
    );
  }

  static blocker(value: { code: CapacityContractCode; message: string }): boolean {
    return value.message === CapacityValidation.messages[value.code];
  }

  static result(value: ResultShape): boolean {
    const cleanup = value.cleanup;
    if (
      cleanup.sandboxId !== value.lease.sandboxId ||
      cleanup.providerGeneration !== value.lease.generations.sandbox
    )
      return false;
    const destroyed = cleanup.disposition === 'destroyed' && cleanup.inspectionDigest !== null;
    if (value.state === 'completed')
      return destroyed && value.output !== null && value.blockers.length === 0;
    if (value.output !== null) return false;
    if (value.state === 'recovery-required')
      return cleanup.disposition === 'failed' && value.blockers.length > 0;
    if (value.state === 'blocked') return destroyed && value.blockers.length > 0;
    return destroyed;
  }

  static ready(value: { ready: boolean; blockers: unknown[] }): boolean {
    return value.ready ? value.blockers.length === 0 : value.blockers.length > 0;
  }
}

/** Portable process-bound probe protocols; shape does not establish authority or runtime evidence. */
export class CapacitySchemas {
  static readonly version = '1.0.0-cordis.1';
  static readonly revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
  static readonly clock = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
  static readonly scope = z.strictObject({
    installationId: SeedSchemas.key,
    installationDirectory: PlatformSchemas.absolute,
    capacityProviderId: SeedSchemas.key,
    project: SeedSchemas.key,
    platformProfile: SeedSchemas.key,
    workerId: SeedSchemas.key,
  });
  static readonly authority = z.strictObject({
    issuer: z.url().refine(CapacityValidation.issuer),
    subject: SeedSchemas.key,
    teamId: SeedSchemas.key,
    providerId: SeedSchemas.key,
    credentialId: SeedSchemas.key,
    credentialRevision: this.revision,
    grantId: SeedSchemas.key,
    grantRevision: this.revision,
    capabilities: SeedSchemas.keys.overwrite(CapacityValidation.capabilities),
    state: z.enum(['granted', 'revoked']),
    expiresAtEpochMs: this.clock,
  });
  static readonly process = z.strictObject({
    compositionGeneration: PlatformSchemas.digest,
    processGeneration: PlatformSchemas.digest,
  });
  static readonly generations = z.strictObject({
    manager: this.process,
    worker: this.process,
    runner: this.process,
    pool: PlatformSchemas.digest,
    sandbox: PlatformSchemas.digest,
    environment: PlatformSchemas.digest,
  });
  static readonly lease = z
    .strictObject({
      schemaVersion: z.literal('treeseed.capacity-lease/v1'),
      operation: z.literal('capacity-probe'),
      id: SeedSchemas.key,
      assignmentId: SeedSchemas.key,
      sandboxId: SeedSchemas.key,
      scope: this.scope,
      authority: this.authority,
      generations: this.generations,
      compatibilityDigest: PlatformSchemas.digest,
      fence: this.revision,
      expiresAtEpochMs: this.clock,
    })
    .refine(CapacityValidation.lease);
  static readonly admission = z.strictObject({
    lease: this.lease,
    authority: this.authority,
    generations: this.generations,
    fence: this.revision,
  });
  static readonly code = z.enum([
    'INVALID_CAPACITY_CONTRACT',
    'CAPACITY_GRANT_REVOKED',
    'CAPACITY_GRANT_EXPIRED',
    'CAPACITY_SCOPE_MISMATCH',
    'CAPACITY_LEASE_EXPIRED',
    'STALE_CAPACITY_GENERATION',
    'STALE_CAPACITY_LEASE',
    'CAPACITY_TARGET_UNREADY',
    'CAPACITY_CAPABILITY_DENIED',
    'CAPACITY_CANCELLED',
    'CAPACITY_HANDLER_FAILED',
    'CAPACITY_CLEANUP_FAILED',
  ]);
  static readonly blocker = z
    .strictObject({ code: this.code, message: z.string().max(128) })
    .refine(CapacityValidation.blocker);
  static readonly cleanup = z.strictObject({
    sandboxId: SeedSchemas.key,
    providerGeneration: PlatformSchemas.digest,
    disposition: z.enum(['destroyed', 'failed']),
    inspectionDigest: PlatformSchemas.digest.nullable(),
  });
  static readonly result = z
    .strictObject({
      schemaVersion: z.literal('treeseed.capacity-result/v1'),
      lease: this.lease,
      state: z.enum(['completed', 'cancelled', 'blocked', 'recovery-required']),
      output: z.string().max(1024).nullable(),
      blockers: z.array(this.blocker).max(16),
      cleanup: this.cleanup,
    })
    .refine(CapacityValidation.result);
  static readonly readiness = z
    .strictObject({
      schemaVersion: z.literal('treeseed.capacity-readiness/v1'),
      role: z.enum(['manager', 'worker', 'runner']),
      scope: this.scope,
      generation: this.process,
      ready: z.boolean(),
      blockers: z.array(this.blocker).max(16),
    })
    .refine(CapacityValidation.ready);
}

export type CapacityScope = z.infer<typeof CapacitySchemas.scope>;
export type CapacityAuthority = z.infer<typeof CapacitySchemas.authority>;
export type CapacityProcessGeneration = z.infer<typeof CapacitySchemas.process>;
export type CapacityGenerations = z.infer<typeof CapacitySchemas.generations>;
export type CapacityLease = z.infer<typeof CapacitySchemas.lease>;
export type CapacityAdmission = z.infer<typeof CapacitySchemas.admission>;
export type CapacityResult = z.infer<typeof CapacitySchemas.result>;
export type CapacityReadiness = z.infer<typeof CapacitySchemas.readiness>;
export type CapacityBlocker = z.infer<typeof CapacitySchemas.blocker>;

export class CapacityContractError extends Error {
  constructor(readonly code: CapacityContractCode) {
    super(code);
    this.name = 'CapacityContractError';
  }

  blocker(): CapacityBlocker {
    return { code: this.code, message: CapacityValidation.messages[this.code] };
  }
}

/** Binding admission only. Callers supply live authenticated observations, never request assertions. */
export class CapacityContractBinding {
  private static parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new CapacityContractError('INVALID_CAPACITY_CONTRACT');
    return result.data;
  }

  private static same(left: unknown, right: unknown, code: CapacityContractCode): void {
    if (CanonicalJson.stringify(left) !== CanonicalJson.stringify(right))
      throw new CapacityContractError(code);
  }

  static assertLease(input: unknown, trusted: unknown, now: number): CapacityLease {
    const lease = CapacityContractBinding.parse(CapacitySchemas.lease, input);
    const admission = CapacityContractBinding.parse(CapacitySchemas.admission, trusted);
    CapacityContractBinding.parse(CapacitySchemas.clock, now);
    CapacityContractBinding.authority(admission.authority, now);
    CapacityContractBinding.same(lease, admission.lease, 'STALE_CAPACITY_LEASE');
    CapacityContractBinding.same(lease.authority, admission.authority, 'CAPACITY_SCOPE_MISMATCH');
    CapacityContractBinding.same(
      lease.generations,
      admission.generations,
      'STALE_CAPACITY_GENERATION',
    );
    if (lease.fence !== admission.fence) throw new CapacityContractError('STALE_CAPACITY_LEASE');
    if (lease.expiresAtEpochMs <= now) throw new CapacityContractError('CAPACITY_LEASE_EXPIRED');
    return lease;
  }

  private static authority(authority: CapacityAuthority, now: number): void {
    if (authority.state !== 'granted') throw new CapacityContractError('CAPACITY_GRANT_REVOKED');
    if (authority.expiresAtEpochMs <= now)
      throw new CapacityContractError('CAPACITY_GRANT_EXPIRED');
    if (!authority.capabilities.includes('agent.probe'))
      throw new CapacityContractError('CAPACITY_CAPABILITY_DENIED');
  }

  static assertResult(input: unknown, expected: unknown): CapacityResult {
    const result = CapacityContractBinding.parse(CapacitySchemas.result, input);
    const lease = CapacityContractBinding.parse(CapacitySchemas.lease, expected);
    CapacityContractBinding.same(result.lease, lease, 'STALE_CAPACITY_LEASE');
    return result;
  }

  static assertReady(
    input: unknown,
    scope: unknown,
    role: CapacityReadiness['role'],
    generation: unknown,
  ): CapacityReadiness {
    const result = CapacityContractBinding.parse(CapacitySchemas.readiness, input);
    const expected = CapacityContractBinding.parse(CapacitySchemas.scope, scope);
    const process = CapacityContractBinding.parse(CapacitySchemas.process, generation);
    CapacityContractBinding.same(result.scope, expected, 'CAPACITY_SCOPE_MISMATCH');
    CapacityContractBinding.same(result.generation, process, 'STALE_CAPACITY_GENERATION');
    if (result.role !== role || !result.ready)
      throw new CapacityContractError('CAPACITY_TARGET_UNREADY');
    return result;
  }
}
