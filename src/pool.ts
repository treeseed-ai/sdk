import { z } from 'zod';
import { CapacitySchemas } from './capacity.js';
import {
  EnvironmentSchemas,
  type EnvironmentDestination,
  type EnvironmentNetworkPolicy,
} from './environments.js';
import { PlatformSchemas, CanonicalJson } from './schemas.js';
import { SeedSchemas } from './seeds.js';

class PoolValidation {
  static policy(value: { warmTarget: number; maximumSandboxes: number }): boolean {
    return value.warmTarget <= value.maximumSandboxes;
  }

  static image(value: { image: { reference: string; manifestDigest: string } }): boolean {
    return value.image.reference.endsWith(`@sha256:${value.image.manifestDigest}`);
  }
}

/** Exact declarations only. Runtime custody, virgin admission and cleanup require owner evidence. */
export class PoolSchemas {
  static readonly version = '1.0.0-cordis.1';
  static readonly count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
  static readonly resources = z.strictObject({
    vcpus: z.number().int().min(1).max(4096),
    memoryMiB: z
      .number()
      .int()
      .min(128)
      .max(16 * 1024 * 1024),
    scratchMiB: z
      .number()
      .int()
      .min(1)
      .max(16 * 1024 * 1024),
  });
  static readonly runtime = z.strictObject({
    name: z.literal('kata'),
    version: PlatformSchemas.version,
    archiveDigest: PlatformSchemas.digest,
  });
  static readonly generations = z.strictObject({
    worker: CapacitySchemas.process,
    runner: PlatformSchemas.digest,
    pool: PlatformSchemas.digest,
    sandbox: PlatformSchemas.digest,
    environment: PlatformSchemas.digest,
  });
  static readonly profileReference = z.strictObject({
    id: SeedSchemas.key,
    revision: PlatformSchemas.digest,
  });
  static readonly compatibility = z
    .strictObject({
      schemaVersion: z.literal('treeseed.pool-compatibility/v1'),
      runtime: this.runtime,
      image: EnvironmentSchemas.image,
      resources: this.resources,
      network: EnvironmentSchemas.network,
      isolationPolicyDigest: PlatformSchemas.digest,
      generations: this.generations,
      hostProfile: this.profileReference.optional(),
    })
    .refine(PoolValidation.image);
  static readonly policy = z
    .strictObject({
      warmTarget: this.count,
      maximumSandboxes: this.count.min(1),
      claimDeadlineMs: z.number().int().min(1).max(86400000),
    })
    .refine(PoolValidation.policy);
  static readonly base = z.strictObject({
    schemaVersion: z.literal('treeseed.virgin-sandbox/v1'),
    id: SeedSchemas.key,
    compatibilityDigest: PlatformSchemas.digest,
    inspectionDigest: PlatformSchemas.digest,
    credentials: z.literal('absent'),
    assigned: z.literal(false),
  });
}

export type PoolCompatibility = z.infer<typeof PoolSchemas.compatibility>;
export type PoolPolicy = z.infer<typeof PoolSchemas.policy>;
export type PoolResourceShape = z.infer<typeof PoolSchemas.resources>;
export type VirginSandbox = z.infer<typeof PoolSchemas.base>;

type ProfileContent = z.infer<typeof SandboxProfileSchemas.content>;
type ProfileProjection = Pick<
  ProfileContent,
  'runtime' | 'image' | 'resources' | 'network' | 'isolationPolicyDigest'
>;
class SandboxProfileCanonical {
  static content(value: ProfileContent): ProfileContent {
    return { schemaVersion: value.schemaVersion, id: value.id, ...this.projection(value) };
  }
  static projection(value: ProfileProjection): ProfileProjection {
    return {
      runtime: value.runtime,
      image: value.image,
      resources: value.resources,
      network: this.network(value.network),
      isolationPolicyDigest: value.isolationPolicyDigest,
    };
  }
  private static network(value: EnvironmentNetworkPolicy): EnvironmentNetworkPolicy {
    if (value.mode === 'offline') return { mode: 'offline', destinations: [] };
    return { mode: 'allow-list', destinations: [...value.destinations].sort(this.compare) };
  }
  private static compare(left: EnvironmentDestination, right: EnvironmentDestination): number {
    const a = CanonicalJson.stringify(left),
      b = CanonicalJson.stringify(right);
    return a < b ? -1 : a > b ? 1 : 0;
  }
}
/** Descriptions only. Deployment must enforce and qualify every advertised field. */
export class SandboxProfileSchemas {
  static readonly version = '1.0.0-cordis.1';
  static readonly content = z
    .strictObject({
      schemaVersion: z.literal('treeseed.sandbox-profile/v1'),
      id: SeedSchemas.key,
      runtime: PoolSchemas.runtime,
      image: EnvironmentSchemas.image,
      resources: PoolSchemas.resources,
      network: EnvironmentSchemas.network,
      isolationPolicyDigest: PlatformSchemas.digest,
    })
    .refine(PoolValidation.image);
  static readonly profile = this.content.safeExtend({ revision: PlatformSchemas.digest });
}
export type SandboxResourceProfile = z.infer<typeof SandboxProfileSchemas.profile>;
export type SandboxProfileContent = z.infer<typeof SandboxProfileSchemas.content>;
export class SandboxProfileError extends Error {
  constructor(readonly code: 'SANDBOX_PROFILE_INVALID' | 'SANDBOX_PROFILE_MISMATCH') {
    super(code);
    this.name = 'SandboxProfileError';
  }
}
/** Pure compatibility admission; never host authentication, authority or physical inspection. */
export class SandboxProfileBinding {
  private static parse<T>(schema: z.ZodType<T>, input: unknown): T {
    try {
      const parsed = schema.safeParse(input);
      if (parsed.success) return parsed.data;
    } catch {
      /* Input inspection must not disclose arbitrary getter or proxy failures. */
    }
    throw new SandboxProfileError('SANDBOX_PROFILE_INVALID');
  }
  private static async digest(value: unknown): Promise<string> {
    try {
      const bytes = new TextEncoder().encode(CanonicalJson.stringify(value));
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      let result = '';
      for (const byte of new Uint8Array(digest)) result += byte.toString(16).padStart(2, '0');
      return result;
    } catch {
      throw new SandboxProfileError('SANDBOX_PROFILE_INVALID');
    }
  }
  static async create(input: unknown): Promise<SandboxResourceProfile> {
    const parsed = this.parse(SandboxProfileSchemas.content, input);
    const content = SandboxProfileCanonical.content(parsed);
    return { ...content, revision: await this.digest(content) };
  }
  static async assert(input: unknown): Promise<SandboxResourceProfile> {
    const parsed = this.parse(SandboxProfileSchemas.profile, input);
    const content = SandboxProfileCanonical.content(parsed);
    if ((await this.digest(content)) !== parsed.revision)
      throw new SandboxProfileError('SANDBOX_PROFILE_INVALID');
    return { ...content, revision: parsed.revision };
  }
  static async assertCompatible(
    input: unknown,
    compatibility: unknown,
  ): Promise<SandboxResourceProfile> {
    const pool = this.parse(PoolSchemas.compatibility, compatibility);
    const profile = await this.assert(input);
    const reference = pool.hostProfile;
    if (!reference || reference.id !== profile.id || reference.revision !== profile.revision)
      throw new SandboxProfileError('SANDBOX_PROFILE_MISMATCH');
    const declared = SandboxProfileCanonical.projection(profile);
    const expected = SandboxProfileCanonical.projection(pool);
    if (CanonicalJson.stringify(declared) !== CanonicalJson.stringify(expected))
      throw new SandboxProfileError('SANDBOX_PROFILE_MISMATCH');
    return profile;
  }
}
