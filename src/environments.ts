import { z } from 'zod';
import { PlatformSchemas, CanonicalJson } from './schemas.js';
import { SeedSchemas } from './seeds.js';

interface Destination { protocol: 'tcp'; host: string; port: number; }

class EnvironmentValidation {
  static host(value: string): boolean {
    if (value.length < 1 || value.length > 253) return false;
    if (/^[0-9.]+$/.test(value)) return EnvironmentValidation.ipv4(value);
    for (const label of value.split('.')) {
      if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return false;
    }
    return true;
  }

  private static ipv4(value: string): boolean {
    const parts = value.split('.');
    if (parts.length !== 4) return false;
    for (const part of parts) {
      const number = Number(part);
      if (String(number) !== part || number < 0 || number > 255) return false;
    }
    return true;
  }

  static unique(values: Destination[]): boolean {
    const keys = new Set<string>();
    for (const value of values) keys.add(CanonicalJson.stringify(value));
    return keys.size === values.length;
  }

  static image(value: { image: { reference: string; manifestDigest: string } }): boolean {
    return value.image.reference.endsWith('@sha256:' + value.image.manifestDigest);
  }

  static offline(): { mode: 'offline'; destinations: [] } {
    return { mode: 'offline', destinations: [] };
  }
}

/** Immutable declarations only: host verification and guest-side enforcement remain owner behavior. */
export class EnvironmentSchemas {
  static readonly version = '1.0.0-cordis.1';
  static readonly destination = z.strictObject({ protocol: z.literal('tcp'),
    host: z.string().refine(EnvironmentValidation.host), port: z.number().int().min(1).max(65535) });
  static readonly network = z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('offline'), destinations: z.array(this.destination).max(0) }),
    z.strictObject({ mode: z.literal('allow-list'),
      destinations: z.array(this.destination).min(1).max(64).refine(EnvironmentValidation.unique) }),
  ]).default(EnvironmentValidation.offline);
  static readonly entrypoint = z.strictObject({
    file: PlatformSchemas.file.extend({ size: z.number().int().min(1).max(64 * 1024 * 1024) }),
    arguments: z.array(z.string().max(4096).regex(/^[^\x00]*$/)).max(64),
    deadlineMs: z.number().int().min(1).max(86400000),
    outputLimitBytes: z.number().int().min(1).max(1024 * 1024),
  });
  static readonly image = z.strictObject({ reference: PlatformSchemas.imageReference,
    manifestDigest: PlatformSchemas.digest, os: z.literal('linux'), architecture: z.literal('amd64') });
  static readonly definition = z.strictObject({ schemaVersion: z.literal('treeseed.agent-environment/v1'),
    id: SeedSchemas.key, revision: PlatformSchemas.digest,
    artifact: SeedSchemas.provider.shape.artifact, image: this.image,
    setup: this.entrypoint, verification: this.entrypoint, network: this.network,
  }).refine(EnvironmentValidation.image);
}

export type EnvironmentDefinition = z.infer<typeof EnvironmentSchemas.definition>;
export type EnvironmentEntrypoint = z.infer<typeof EnvironmentSchemas.entrypoint>;
export type EnvironmentNetworkPolicy = z.infer<typeof EnvironmentSchemas.network>;
export type EnvironmentDestination = z.infer<typeof EnvironmentSchemas.destination>;
export type EnvironmentContractCode = 'INVALID_ENVIRONMENT_CONTRACT' | 'ENVIRONMENT_NETWORK_DENIED';

export class EnvironmentContractError extends Error {
  constructor(readonly code: EnvironmentContractCode) {
    super(code);
    this.name = 'EnvironmentContractError';
  }
}

/** Computes already-trusted policy intersection; it never creates grants or enforces egress. */
export class EnvironmentNetwork {
  static intersect(requested: unknown, host: unknown, assignment: unknown): EnvironmentNetworkPolicy {
    const desire = EnvironmentNetwork.parse(requested);
    const hostPolicy = EnvironmentNetwork.parse(host);
    const grant = EnvironmentNetwork.parse(assignment);
    if (desire.mode === 'offline') return desire;
    for (const destination of desire.destinations) {
      EnvironmentNetwork.require(hostPolicy, destination);
      EnvironmentNetwork.require(grant, destination);
    }
    return { mode: 'allow-list', destinations: [...desire.destinations].sort(EnvironmentNetwork.compare) };
  }

  private static parse(value: unknown): EnvironmentNetworkPolicy {
    const result = EnvironmentSchemas.network.safeParse(value);
    if (!result.success) throw new EnvironmentContractError('INVALID_ENVIRONMENT_CONTRACT');
    return result.data;
  }

  private static require(policy: EnvironmentNetworkPolicy, destination: EnvironmentDestination): void {
    if (policy.mode === 'allow-list') {
      for (const accepted of policy.destinations) {
        if (EnvironmentNetwork.compare(accepted, destination) === 0) return;
      }
    }
    throw new EnvironmentContractError('ENVIRONMENT_NETWORK_DENIED');
  }

  private static compare(left: EnvironmentDestination, right: EnvironmentDestination): number {
    const a = CanonicalJson.stringify(left);
    const b = CanonicalJson.stringify(right);
    return a < b ? -1 : a > b ? 1 : 0;
  }
}
