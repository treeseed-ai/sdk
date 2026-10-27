import { z } from 'zod';
import { PlatformSchemas } from './schemas.js';
import { SeedSchemas } from './seeds.js';

interface ProfileNode {
  id: string;
  dependsOn: string[];
}

/** Declaration graph only: no service instances or lifecycle behavior. */
class ActivityGraph {
  private readonly remaining = new Map<string, ProfileNode>();
  private readonly complete = new Set<string>();

  constructor(profiles: ProfileNode[]) {
    for (const profile of profiles) this.remaining.set(profile.id, profile);
  }

  valid(count: number): boolean {
    if (this.remaining.size !== count) return false;
    while (this.remaining.size) {
      const before = this.remaining.size;
      for (const [id, profile] of this.remaining) {
        if (!this.ready(profile)) continue;
        this.remaining.delete(id);
        this.complete.add(id);
      }
      if (before === this.remaining.size) return false;
    }
    return true;
  }

  private ready(profile: ProfileNode): boolean {
    for (const dependency of profile.dependsOn) if (!this.complete.has(dependency)) return false;
    return true;
  }
}

class ActivityValidation {
  static definition(value: { profiles: ProfileNode[] }): boolean {
    return new ActivityGraph(value.profiles).valid(value.profiles.length);
  }
}

/** Parameters still require the accepted profile provider's validator. */
export class ActivitySchemas {
  static readonly version = '1.0.0-cordis.1';
  static readonly coreTypes = [
    'planning',
    'estimating',
    'acting',
    'reviewing',
    'reporting',
    'chat',
  ] as const;
  static readonly contract = z.strictObject({
    capability: SeedSchemas.identifier,
    contractVersion: PlatformSchemas.version,
  });
  static readonly capability = z.strictObject({
    typeId: SeedSchemas.identifier,
    revision: PlatformSchemas.digest,
    provider: SeedSchemas.provider.extend({ target: z.literal('agent') }),
    parameterSchema: SeedSchemas.schema,
    handler: this.contract,
    orchestration: this.contract,
  });
  static readonly instance = z.strictObject({
    id: SeedSchemas.key,
    typeId: SeedSchemas.identifier,
    capabilityRevision: PlatformSchemas.digest,
    handler: this.contract.extend({ providerId: SeedSchemas.identifier }),
    environmentId: SeedSchemas.key,
    parameters: z.record(z.string(), z.json()),
    dependsOn: SeedSchemas.keys,
  });
  static readonly definition = z
    .strictObject({
      schemaVersion: z.literal('treeseed.agent-definition/v1'),
      id: SeedSchemas.key,
      revision: PlatformSchemas.digest,
      profiles: z.array(this.instance).min(1).max(256),
    })
    .refine(ActivityValidation.definition);
  static readonly catalogue = z.array(this.capability).min(1).max(256);
}

export type ActivityCapability = z.infer<typeof ActivitySchemas.capability>;
export type ActivityProfile = z.infer<typeof ActivitySchemas.instance>;
export type AgentDefinition = z.infer<typeof ActivitySchemas.definition>;
export interface ResolvedActivityDefinition {
  readonly instance: ActivityProfile;
  readonly capability: ActivityCapability;
}

export type ActivityContractCode =
  | 'INVALID_ACTIVITY_CONTRACT'
  | 'ACTIVITY_TYPE_UNAVAILABLE'
  | 'ACTIVITY_TYPE_AMBIGUOUS'
  | 'ACTIVITY_REVISION_MISMATCH'
  | 'ACTIVITY_HANDLER_INCOMPATIBLE';

export class ActivityContractError extends Error {
  constructor(readonly code: ActivityContractCode) {
    super(code);
    this.name = 'ActivityContractError';
  }
}

/** Structural selection only; no permission grants, package imports or parameter execution. */
export class ActivityContractBinding {
  static resolve(input: unknown, capabilities: unknown): ResolvedActivityDefinition[] {
    const definition = ActivityContractBinding.parse(ActivitySchemas.definition, input);
    const catalogue = ActivityContractBinding.parse(ActivitySchemas.catalogue, capabilities);
    const selected = ActivityContractBinding.selected(catalogue);
    const result: ResolvedActivityDefinition[] = [];
    for (const instance of definition.profiles) {
      const capability = selected.get(instance.typeId);
      if (!capability) throw new ActivityContractError('ACTIVITY_TYPE_UNAVAILABLE');
      ActivityContractBinding.compatible(instance, capability);
      result.push({ instance, capability });
    }
    return result;
  }

  private static parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) throw new ActivityContractError('INVALID_ACTIVITY_CONTRACT');
    return result.data;
  }

  private static selected(values: ActivityCapability[]): Map<string, ActivityCapability> {
    const selected = new Map<string, ActivityCapability>();
    for (const value of values) {
      if (selected.has(value.typeId)) throw new ActivityContractError('ACTIVITY_TYPE_AMBIGUOUS');
      selected.set(value.typeId, value);
    }
    return selected;
  }

  private static compatible(instance: ActivityProfile, capability: ActivityCapability): void {
    if (instance.capabilityRevision !== capability.revision) {
      throw new ActivityContractError('ACTIVITY_REVISION_MISMATCH');
    }
    const actual = instance.handler;
    const required = capability.handler;
    if (
      actual.capability !== required.capability ||
      actual.contractVersion !== required.contractVersion
    ) {
      throw new ActivityContractError('ACTIVITY_HANDLER_INCOMPATIBLE');
    }
  }
}
