import { z } from 'zod';
import { CapacitySchemas } from './capacity.js';
import { EnvironmentSchemas } from './environments.js';
import { PlatformSchemas } from './schemas.js';
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
  static readonly compatibility = z
    .strictObject({
      schemaVersion: z.literal('treeseed.pool-compatibility/v1'),
      runtime: this.runtime,
      image: EnvironmentSchemas.image,
      resources: this.resources,
      network: EnvironmentSchemas.network,
      isolationPolicyDigest: PlatformSchemas.digest,
      generations: this.generations,
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
