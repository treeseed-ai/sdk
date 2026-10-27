import { z } from "zod";
import {
  CanonicalJson,
  PlatformSchemas,
  ProviderV4Schemas,
} from "./schemas.js";
import { PluginManagementSchemas } from "./management.js";

interface DependencyNode {
  key: string;
  dependsOn: string[];
}
interface RequiredNode extends DependencyNode {
  requires: string[];
}
interface SelectedProvider {
  id: string;
  capability: string;
  target: string;
  scopeId: string;
  contractVersion: string;
  artifact: { package: string; version: string; integrity: string };
  executableDigest: string;
}
interface ArtifactLockShape {
  provider: SelectedProvider;
  source: string;
  closureDigest: string;
  receipt: {
    locator: string;
    closureDigest: string;
    name: string;
    version: string;
    archiveDigest: string;
  };
}

class SeedGraph {
  private readonly nodes = new Map<string, DependencyNode>();
  private readonly visiting = new Set<string>();
  private readonly visited = new Set<string>();

  constructor(private readonly resources: DependencyNode[]) {
    for (const node of resources) this.nodes.set(node.key, node);
  }

  valid(): boolean {
    if (this.nodes.size !== this.resources.length) return false;
    for (const node of this.resources) {
      for (const dependency of node.dependsOn) {
        if (!this.nodes.has(dependency) || dependency === node.key)
          return false;
      }
    }
    for (const key of this.nodes.keys()) if (!this.visit(key)) return false;
    return true;
  }

  private visit(key: string): boolean {
    if (this.visited.has(key)) return true;
    if (this.visiting.has(key)) return false;
    this.visiting.add(key);
    for (const dependency of this.nodes.get(key)!.dependsOn) {
      if (!this.visit(dependency)) return false;
    }
    this.visiting.delete(key);
    this.visited.add(key);
    return true;
  }
}

class SeedValidation {
  static unique(values: string[]): boolean {
    return new Set(values).size === values.length;
  }

  static bundle(value: {
    requirements: Array<{ key: string; scopeId: string; capability: string }>;
    resources: RequiredNode[];
  }): boolean {
    const keys = new Set<string>();
    const selections = new Set<string>();
    for (const requirement of value.requirements) {
      const selection = requirement.scopeId + "/" + requirement.capability;
      if (keys.has(requirement.key) || selections.has(selection)) return false;
      keys.add(requirement.key);
      selections.add(selection);
    }
    for (const resource of value.resources) {
      for (const requirement of resource.requires)
        if (!keys.has(requirement)) return false;
    }
    return new SeedGraph(value.resources).valid();
  }

  static lock(value: ArtifactLockShape): boolean {
    const receipt = value.receipt;
    const artifact = value.provider.artifact;
    return (
      receipt.locator === value.source &&
      receipt.closureDigest === value.closureDigest &&
      receipt.name === artifact.package &&
      receipt.version === artifact.version &&
      receipt.archiveDigest === artifact.integrity
    );
  }

  static plan(value: SeedPlanShape): boolean {
    if (
      value.id !== "seed-plan-" + value.digest ||
      !new SeedGraph(value.resources).valid()
    )
      return false;
    const locks = SeedValidation.locks(value.locks);
    if (!locks) return false;
    for (const resource of value.resources) {
      if (!resource.requires.includes(resource.providerRequirement))
        return false;
      for (const key of resource.requires) if (!locks.has(key)) return false;
      const lock = locks.get(resource.providerRequirement);
      if (!lock || !this.same(lock.provider, resource.provider)) return false;
    }
    return true;
  }

  static resourceReceipt(value: ResourceReceiptShape): boolean {
    if (value.state !== "verified") return true;
    return (
      value.record !== null &&
      value.observedDigest === value.desiredDigest &&
      value.blockers.length === 0
    );
  }

  private static locks(values: SeedArtifactLock[]): Map<string, SeedArtifactLock> | null {
    const result = new Map<string, SeedArtifactLock>();
    const selections = new Set<string>();
    for (const value of values) {
      const selection = value.provider.scopeId + '/' + value.provider.capability;
      if (result.has(value.requirement) || selections.has(selection)) return null;
      result.set(value.requirement, value);
      selections.add(selection);
    }
    return result;
  }

  static receipt(value: ReceiptShape): boolean {
    if (value.planId !== "seed-plan-" + value.planDigest) return false;
    const expected = new Map<string, SeedResourcePlan>();
    const received = new Set<string>();
    for (const resource of value.expectedResources)
      expected.set(resource.key, resource);
    if (expected.size !== value.expectedResources.length) return false;
    for (const resource of value.resources) {
      const plan = expected.get(resource.key);
      if (
        !plan ||
        received.has(resource.key) ||
        !this.matchesResource(plan, resource)
      )
        return false;
      if (value.state === "completed" && resource.state !== "verified")
        return false;
      received.add(resource.key);
    }
    return (
      value.state !== "completed" ||
      (received.size === expected.size && value.blockers.length === 0)
    );
  }

  static matchesResource(
    plan: SeedResourcePlan,
    receipt: ResourceReceiptShape,
  ): boolean {
    if (
      plan.key !== receipt.key ||
      plan.desiredDigest !== receipt.desiredDigest ||
      plan.owner !== receipt.owner ||
      !this.same(plan.provider, receipt.provider)
    )
      return false;
    return (
      receipt.state !== "verified" ||
      plan.desiredGeneration === receipt.generation
    );
  }

  static same(left: unknown, right: unknown): boolean {
    return CanonicalJson.stringify(left) === CanonicalJson.stringify(right);
  }
}

/** Portable data and semantic validation; these contracts never create trust or authority. */
export class SeedSchemas {
  static readonly version = "1.0.0-cordis.1";
  static readonly key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
  static readonly keys = z
    .array(this.key)
    .max(256)
    .refine(SeedValidation.unique);
  static readonly identifier = ProviderV4Schemas.declaration.shape.id;
  static readonly schema = z.strictObject({
    id: this.identifier,
    version: PlatformSchemas.version,
    digest: PlatformSchemas.digest,
  });
  static readonly binding = z.strictObject({
    installationId: this.key,
    installationDirectory: PlatformSchemas.absolute,
    project: this.key,
    profile: this.key,
    principalId: this.key,
    resourceScope: this.key,
    grantId: this.key,
    grantRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  });
  static readonly provider = z.strictObject({
    id: this.identifier,
    capability: this.identifier,
    target: ProviderV4Schemas.target,
    scopeId: this.key,
    contractVersion: PlatformSchemas.version,
    artifact: PlatformSchemas.artifact.extend({
      package: PlatformSchemas.packageName,
      version: PlatformSchemas.version,
    }),
    executableDigest: PlatformSchemas.digest,
  });
  static readonly requirement = z.strictObject({
    key: this.key,
    scopeId: this.key,
    capability: this.identifier,
    providerId: this.identifier,
    target: ProviderV4Schemas.target,
    contractVersion: PlatformSchemas.version,
    source: PluginManagementSchemas.source,
  });
  static readonly resource = z.strictObject({
    key: this.key,
    kind: this.identifier,
    schema: this.schema,
    requires: this.keys.min(1),
    dependsOn: this.keys,
    payload: z.record(z.string(), z.json()),
  });
  static readonly bundle = z
    .strictObject({
      schemaVersion: z.literal("treeseed.seed-bundle/v4"),
      name: this.identifier,
      version: z.number().int().positive(),
      digest: PlatformSchemas.digest,
      requirements: z.array(this.requirement).min(1).max(256),
      resources: z.array(this.resource).min(1).max(256),
    })
    .refine(SeedValidation.bundle);
  static readonly lock = z
    .strictObject({
      requirement: this.key,
      provider: this.provider,
      closureDigest: PlatformSchemas.digest,
      source: PluginManagementSchemas.source,
      receipt: PluginManagementSchemas.sourceReceipt,
    })
    .refine(SeedValidation.lock);
  static readonly effect = z.strictObject({
    kind: this.identifier,
    target: this.key,
  });
  static readonly resourcePlan = z.strictObject({
    key: this.key,
    kind: this.identifier,
    schema: this.schema,
    requires: this.keys.min(1),
    dependsOn: this.keys,
    providerRequirement: this.key,
    provider: this.provider,
    owner: this.identifier,
    configurationDigest: PlatformSchemas.digest,
    desiredDigest: PlatformSchemas.digest,
    expectedGeneration: PlatformSchemas.digest.nullable(),
    desiredGeneration: PlatformSchemas.digest.nullable(),
    previousRecord: this.key.nullable(),
    effects: z.array(this.effect).max(256),
  });
  static readonly plan = z
    .strictObject({
      schemaVersion: z.literal("treeseed.seed-plan/v1"),
      id: z.string().regex(/^seed-plan-[a-f0-9]{64}$/),
      digest: PlatformSchemas.digest,
      seedDigest: PlatformSchemas.digest,
      binding: this.binding,
      locks: z.array(this.lock).min(1).max(256),
      resources: z.array(this.resourcePlan).min(1).max(256),
      blockers: z.array(PlatformSchemas.blocker).max(0),
    })
    .refine(SeedValidation.plan.bind(SeedValidation));
  static readonly resourceReceipt = z
    .strictObject({
      key: this.key,
      provider: this.provider,
      desiredDigest: PlatformSchemas.digest,
      state: z.enum(["verified", "pending", "blocked", "recovery-required"]),
      owner: this.identifier,
      record: this.key.nullable(),
      observedDigest: PlatformSchemas.digest.nullable(),
      generation: PlatformSchemas.digest.nullable(),
      blockers: z.array(PlatformSchemas.blocker).max(64),
    })
    .refine(SeedValidation.resourceReceipt);
  static readonly receipt = z
    .strictObject({
      schemaVersion: z.literal("treeseed.seed-receipt/v1"),
      requestId: this.key,
      planId: z.string().regex(/^seed-plan-[a-f0-9]{64}$/),
      planDigest: PlatformSchemas.digest,
      binding: this.binding,
      expectedResources: z.array(this.resourcePlan).min(1).max(256),
      resources: z.array(this.resourceReceipt).max(256),
      state: z.enum([
        "completed",
        "partial",
        "pending",
        "blocked",
        "recovery-required",
      ]),
      blockers: z.array(PlatformSchemas.blocker).max(64),
    })
    .refine(SeedValidation.receipt.bind(SeedValidation));
}

export type SeedBundle = z.infer<typeof SeedSchemas.bundle>;
export type SeedResource = z.infer<typeof SeedSchemas.resource>;
export type SeedRequirement = z.infer<typeof SeedSchemas.requirement>;
export type SeedArtifactLock = z.infer<typeof SeedSchemas.lock>;
export type SeedBinding = z.infer<typeof SeedSchemas.binding>;
export type SeedResourcePlan = z.infer<typeof SeedSchemas.resourcePlan>;
export type SeedPlan = z.infer<typeof SeedSchemas.plan>;
export type SeedResourceReceipt = z.infer<typeof SeedSchemas.resourceReceipt>;
export type SeedReceipt = z.infer<typeof SeedSchemas.receipt>;

interface SeedPlanShape {
  id: string;
  digest: string;
  locks: SeedArtifactLock[];
  resources: SeedResourcePlan[];
}
interface ResourceReceiptShape {
  key: string;
  provider: SelectedProvider;
  owner: string;
  desiredDigest: string;
  state: string;
  record: string | null;
  observedDigest: string | null;
  generation: string | null;
  blockers: unknown[];
}
interface ReceiptShape {
  planId: string;
  planDigest: string;
  expectedResources: SeedResourcePlan[];
  resources: ResourceReceiptShape[];
  state: string;
  blockers: unknown[];
}

export interface SeedResourceContext {
  readonly binding: SeedBinding;
  readonly requestId: string;
  readonly signal: AbortSignal;
}

export interface SeedResourceValidation {
  readonly valid: boolean;
  readonly blockers: SeedPlan["blockers"];
}

export interface SeedResourceProvider {
  validate(
    resource: SeedResource,
    context: SeedResourceContext,
  ): Promise<SeedResourceValidation>;
  plan(
    resource: SeedResource,
    context: SeedResourceContext,
  ): Promise<SeedResourcePlan>;
  reconcile(
    plan: SeedResourcePlan,
    context: SeedResourceContext,
  ): Promise<SeedResourceReceipt>;
  readBack(
    receipt: SeedResourceReceipt,
    context: SeedResourceContext,
  ): Promise<SeedResourceReceipt>;
}

export type SeedContractCode =
  | "INVALID_SEED_CONTRACT"
  | "SEED_BINDING_MISMATCH"
  | "SEED_RESOURCE_MISMATCH";
export class SeedContractError extends Error {
  constructor(readonly code: SeedContractCode) {
    super(code);
    this.name = "SeedContractError";
  }
}

/** Equality admission only; callers resolve live authenticated authority and actual owner read-back. */
export class SeedContractBinding {
  private static parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) throw new SeedContractError("INVALID_SEED_CONTRACT");
    return result.data;
  }

  static assertPlan(
    input: unknown,
    trusted: unknown,
    seedDigest: string,
  ): SeedPlan {
    const plan = SeedContractBinding.parse(SeedSchemas.plan, input);
    const binding = SeedContractBinding.parse(SeedSchemas.binding, trusted);
    if (
      !SeedValidation.same(plan.binding, binding) ||
      plan.seedDigest !== seedDigest
    ) {
      throw new SeedContractError("SEED_BINDING_MISMATCH");
    }
    return plan;
  }

  static assertResource(
    expected: unknown,
    input: unknown,
  ): SeedResourceReceipt {
    const plan = SeedContractBinding.parse(SeedSchemas.resourcePlan, expected);
    const receipt = SeedContractBinding.parse(
      SeedSchemas.resourceReceipt,
      input,
    );
    if (!SeedValidation.matchesResource(plan, receipt))
      throw new SeedContractError("SEED_RESOURCE_MISMATCH");
    return receipt;
  }

  static assertReceipt(input: unknown, expected: unknown): SeedReceipt {
    const receipt = SeedContractBinding.parse(SeedSchemas.receipt, input);
    const plan = SeedContractBinding.parse(SeedSchemas.plan, expected);
    if (
      receipt.planId !== plan.id ||
      receipt.planDigest !== plan.digest ||
      !SeedValidation.same(receipt.binding, plan.binding) ||
      !SeedValidation.same(receipt.expectedResources, plan.resources)
    ) {
      throw new SeedContractError("SEED_BINDING_MISMATCH");
    }
    return receipt;
  }
}
