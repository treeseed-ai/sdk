import { z } from 'zod';

interface AvailabilityLane {
  id: string;
  purpose: string;
  maxConcurrentWorkers: number;
  reservedConcurrentWorkers: number;
}
interface AvailabilityAdapter {
  id: string;
  laneIds: string[];
  maxConcurrentWorkers: number;
  activeWorkers: number;
  offers: Array<{ offerId: string }>;
}
interface AvailabilityTopology {
  adapters: AvailabilityAdapter[];
  lanes: AvailabilityLane[];
}
interface CapabilityReference {
  id: string;
  version: string;
}
interface OfferShape {
  capabilities: CapabilityReference[];
  inputContracts: CapabilityReference[];
  outputContracts: CapabilityReference[];
}
class AvailabilityValidation {
  static unique(values: string[]): boolean {
    return new Set(values).size === values.length;
  }
  static reference(value: CapabilityReference): string {
    return value.id + '@' + value.version;
  }
  static offer(value: OfferShape): boolean {
    return (
      this.unique(value.capabilities.map(this.reference)) &&
      this.unique(value.inputContracts.map(this.reference)) &&
      this.unique(value.outputContracts.map(this.reference))
    );
  }
  static adapter(value: { activeWorkers: number; maxConcurrentWorkers: number }): boolean {
    return value.activeWorkers <= value.maxConcurrentWorkers;
  }
  static lane(value: AvailabilityLane): boolean {
    return value.reservedConcurrentWorkers <= value.maxConcurrentWorkers;
  }
  static topology(value: AvailabilityTopology): boolean {
    const lanes = new Set(value.lanes.map(this.id)),
      used = new Set<string>(),
      offers = new Set<string>();
    if (!this.unique(value.lanes.map(this.id)) || !this.unique(value.lanes.map(this.purpose)))
      return false;
    if (!this.unique(value.adapters.map(this.id))) return false;
    for (const adapter of value.adapters) {
      for (const lane of adapter.laneIds) {
        if (!lanes.has(lane)) return false;
        used.add(lane);
      }
      for (const offer of adapter.offers) {
        if (offers.has(offer.offerId)) return false;
        offers.add(offer.offerId);
      }
    }
    return used.size === lanes.size && lanes.size === 3;
  }
  static id(value: { id: string }): string {
    return value.id;
  }
  static purpose(value: { purpose: string }): string {
    return value.purpose;
  }
  static window(value: { availableFrom?: string; availableUntil?: string | null }): boolean {
    return (
      !value.availableFrom ||
      !value.availableUntil ||
      Date.parse(value.availableUntil) > Date.parse(value.availableFrom)
    );
  }
  static context(value: {
    mode: string;
    defaultInitial?: number;
    maximum?: number;
    reservedOutput?: number;
    measurement?: string | null;
  }): boolean {
    if (value.mode !== 'bounded') return true;
    return (
      value.defaultInitial! <= value.maximum! &&
      (value.measurement !== 'tokens' || value.reservedOutput! < value.maximum!)
    );
  }
  static observation(value: { day: string; observedAt: string }): boolean {
    const time = Date.parse(value.observedAt);
    return Number.isFinite(time) && value.day === new Date(time).toISOString().slice(0, 10);
  }
  static request(value: {
    capacity?: { maxConcurrentWorkers: number };
    runnerPressure?: {
      pressure?: string;
      throttleState?: string;
      maxConcurrentWorkers?: number;
      activeWorkers?: number;
      availableWorkers?: number;
      reservedWorkers?: number;
    };
  }): boolean {
    const pressure = value.runnerPressure;
    if (!pressure) return true;
    if (pressure.pressure && pressure.throttleState && pressure.pressure !== pressure.throttleState)
      return false;
    const maximum = pressure.maxConcurrentWorkers ?? value.capacity?.maxConcurrentWorkers;
    if (maximum === undefined) return true;
    return (
      (pressure.activeWorkers ?? 0) <= maximum &&
      (pressure.availableWorkers ?? 0) <= maximum &&
      (pressure.reservedWorkers ?? 0) <= maximum
    );
  }
  static closure(value: { status: string; closedAt?: string | null }): boolean {
    if (value.status === 'closed') return !!value.closedAt;
    return !['open', 'draining'].includes(value.status) || !value.closedAt;
  }
  static evidence(value: { issuedAt: string; expiresAt: string | null }): boolean {
    return !value.expiresAt || Date.parse(value.expiresAt) > Date.parse(value.issuedAt);
  }
  static session(value: {
    sequence: number;
    openedAt: string;
    refreshedAt: string;
    expiresAt: string;
    closedAt?: string | null;
    snapshot: {
      sequence: number;
      availableWorkers: number;
      reservedWorkers: number;
      maxConcurrentWorkers: number;
    };
  }): boolean {
    return (
      value.sequence === value.snapshot.sequence &&
      Date.parse(value.openedAt) <= Date.parse(value.refreshedAt) &&
      Date.parse(value.refreshedAt) < Date.parse(value.expiresAt) &&
      (!value.closedAt || Date.parse(value.closedAt) >= Date.parse(value.openedAt)) &&
      value.snapshot.availableWorkers <= value.snapshot.maxConcurrentWorkers &&
      value.snapshot.reservedWorkers <= value.snapshot.maxConcurrentWorkers
    );
  }
}

/** Existing provider wire data only; parsing never establishes approval or signature validity. */
export class ProviderAvailabilitySchemas {
  static readonly version = 'treeseed.provider-availability/v1';
  static readonly key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
  static readonly identifier = z.string().regex(/^[a-z][a-z0-9.-]{1,191}$/);
  static readonly text = z.string().min(1).max(256);
  static readonly digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
  static readonly semver = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  static readonly timestamp = z.string().datetime({ offset: true });
  static readonly counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
  static readonly positive = this.counter.min(1);
  static readonly metadata = z.record(z.string(), z.json());
  static readonly names = z.array(this.text).max(256).refine(AvailabilityValidation.unique);
  static readonly identifiers = z
    .array(this.identifier)
    .max(256)
    .refine(AvailabilityValidation.unique);
  static readonly reference = z.strictObject({
    id: z
      .string()
      .regex(/^(?:treeseed\.[a-z][a-z0-9.-]*|provider\.[a-f0-9]{16,64}\.[a-z][a-z0-9.-]*)$/)
      .max(256),
    version: this.semver,
    digest: this.digest,
  });
  static readonly artifact = z.strictObject({
    id: this.identifier,
    version: this.semver,
    digest: this.digest,
    mediaTypes: z.array(this.text).max(256).refine(AvailabilityValidation.unique),
  });
  static readonly signature = z.strictObject({
    keyId: this.identifier,
    algorithm: z.literal('Ed25519'),
    value: z.string().min(1).max(16384),
  });
  static readonly conformance = z
    .strictObject({
      schemaVersion: z.literal('treeseed.capability-conformance/v1'),
      providerId: this.key,
      capability: this.reference,
      tier: z.enum(['signed-attestation', 'automated-suite', 'reviewed-certification']),
      status: z.enum(['passed', 'failed', 'revoked']),
      evidenceDigest: this.digest,
      suite: z.strictObject({ id: this.identifier, version: this.semver }).nullable(),
      issuedAt: this.timestamp,
      expiresAt: this.timestamp.nullable(),
      signature: this.signature,
    })
    .refine(AvailabilityValidation.evidence);
  static readonly provenance = z.strictObject({
    provider: this.identifier,
    implementation: this.text,
    version: this.text.nullable(),
  });
  static readonly context = z
    .discriminatedUnion('mode', [
      z.strictObject({
        mode: z.literal('bounded'),
        measurement: z.enum(['tokens', 'bytes', 'items']),
        defaultInitial: this.positive,
        maximum: this.positive,
        reservedOutput: this.counter,
        transportPayloadBytes: this.positive,
        measurementProvenance: this.provenance,
      }),
      z.strictObject({
        mode: z.literal('unbounded'),
        measurement: z.enum(['tokens', 'bytes', 'items']).nullable(),
        transportPayloadBytes: this.positive,
        measurementProvenance: this.provenance,
      }),
    ])
    .refine(AvailabilityValidation.context);
  static readonly offer = z
    .strictObject({
      schemaVersion: z.literal('treeseed.capability-offer/v2'),
      offerId: this.identifier,
      capabilities: z.array(this.reference).min(1).max(256),
      features: this.identifiers,
      configurationSupport: z.record(
        this.identifier,
        z.strictObject({ required: z.boolean(), preferred: z.boolean() }),
      ),
      permissionClasses: this.identifiers,
      contextModes: this.identifiers,
      inputContracts: z.array(this.artifact).max(256),
      outputContracts: z.array(this.artifact).max(256),
      interactionModes: this.identifiers,
      conformance: z.array(this.conformance).min(1).max(256),
      contextCapacity: this.context,
      limits: this.metadata,
      commercial: z.strictObject({
        currency: z.string().length(3).nullable(),
        estimatedCost: z.number().finite().nonnegative().nullable(),
      }),
      region: this.text.nullable(),
      trust: this.identifiers,
      offerDigest: this.digest,
    })
    .refine(AvailabilityValidation.offer.bind(AvailabilityValidation));
  static readonly accounting = z
    .strictObject({
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      observedAt: this.timestamp,
      healthy: z.boolean(),
      activeSeconds: z.number().finite().nonnegative(),
      reservedSeconds: z.number().finite().nonnegative(),
    })
    .refine(AvailabilityValidation.observation);
  static readonly adapter = z
    .strictObject({
      id: this.key,
      adapter: this.text,
      runtimeBuild: this.digest,
      offers: z.array(this.offer).min(1).max(256),
      isolation: z.enum(['microvm', 'process', 'worker']),
      status: z.enum(['available', 'degraded', 'unavailable']),
      capabilities: this.names,
      laneIds: z.array(this.key).min(1).max(3).refine(AvailabilityValidation.unique),
      maxConcurrentWorkers: this.counter,
      activeWorkers: this.counter,
      nativeLimits: this.metadata,
      observations: this.metadata.optional(),
      accountingObservation: z
        .strictObject({
          modelUsage: this.accounting,
          capabilityUsage: z.record(z.string(), this.accounting),
        })
        .optional(),
    })
    .refine(AvailabilityValidation.adapter);
  static readonly purpose = z.enum(['communication', 'platform', 'workday']);
  static readonly lane = z
    .strictObject({
      id: this.key,
      purpose: this.purpose,
      priority: z.number().int().min(-2147483648).max(2147483647),
      reservedConcurrentWorkers: this.counter,
      maxConcurrentWorkers: this.counter,
      borrowWhenIdle: z.boolean(),
      lendWhenIdle: z.boolean(),
      reclaimPolicy: z.literal('admission'),
      queueLimit: this.counter,
      timeoutSeconds: this.positive,
      capabilities: this.names.optional(),
    })
    .refine(AvailabilityValidation.lane);
  static readonly laneSnapshot = z
    .strictObject({
      id: this.key,
      purpose: this.purpose,
      status: z.enum(['active', 'paused', 'degraded', 'revoked']),
      priority: z.number().int().min(-2147483648).max(2147483647),
      reservedConcurrentWorkers: this.counter,
      borrowedWorkers: this.counter,
      lentWorkers: this.counter,
      queuedAssignments: this.counter,
      capabilities: this.names,
      maxConcurrentWorkers: this.counter,
      activeWorkers: this.counter,
    })
    .refine(AvailabilityValidation.lane)
    .refine(AvailabilityValidation.adapter);
  static readonly pressure = z.enum(['idle', 'normal', 'busy', 'throttled', 'exhausted']);
  static readonly requestShape = z.strictObject({
    adapters: z.array(this.adapter).min(1).max(256),
    lanes: z.array(this.lane).length(3),
    ttlSeconds: z.number().int().min(30).max(300).optional(),
    environment: this.text.nullable().optional(),
    status: z.literal('open').optional(),
    availableFrom: this.timestamp.optional(),
    availableUntil: this.timestamp.nullable().optional(),
    capabilities: this.names.optional(),
    capacity: z.object({ maxConcurrentWorkers: this.counter }).catchall(z.json()).optional(),
    runnerPressure: z
      .object({
        pressure: this.pressure.optional(),
        throttleState: this.pressure.optional(),
        maxConcurrentWorkers: this.counter.optional(),
        activeWorkers: this.counter.optional(),
        activeAssignmentIds: z
          .array(this.key)
          .max(4096)
          .refine(AvailabilityValidation.unique)
          .optional(),
        reservedWorkers: this.counter.optional(),
        borrowedWorkers: this.counter.optional(),
        availableWorkers: this.counter.optional(),
      })
      .strict()
      .optional(),
    constraints: this.metadata.optional(),
    metadata: this.metadata.optional(),
  });
  static readonly create = this.requestShape
    .refine(AvailabilityValidation.topology.bind(AvailabilityValidation))
    .refine(AvailabilityValidation.window)
    .refine(AvailabilityValidation.request);
  static readonly refresh = this.requestShape
    .extend({ expectedSequence: this.positive })
    .refine(AvailabilityValidation.topology.bind(AvailabilityValidation))
    .refine(AvailabilityValidation.window)
    .refine(AvailabilityValidation.request);
  static readonly snapshot = z
    .strictObject({
      sequence: this.positive,
      availableFrom: this.timestamp,
      availableUntil: this.timestamp.nullable().optional(),
      pressure: this.pressure,
      maxConcurrentWorkers: this.counter,
      activeAssignmentIds: z.array(this.key).max(4096).refine(AvailabilityValidation.unique),
      reservedWorkers: this.counter,
      borrowedWorkers: this.counter,
      availableWorkers: this.counter,
      adapters: z.array(this.adapter).min(1).max(256),
      lanes: z.array(this.laneSnapshot).length(3),
      capabilities: this.names,
      constraints: this.metadata.optional(),
    })
    .refine(AvailabilityValidation.topology.bind(AvailabilityValidation))
    .refine(AvailabilityValidation.window);
  static readonly session = z
    .strictObject({
      id: this.key,
      membershipId: this.key,
      teamId: this.key,
      providerId: this.key,
      status: z.enum(['open', 'draining', 'closed', 'expired']),
      sequence: this.positive,
      snapshot: this.snapshot,
      openedAt: this.timestamp,
      refreshedAt: this.timestamp,
      expiresAt: this.timestamp,
      closedAt: this.timestamp.nullable().optional(),
    })
    .refine(AvailabilityValidation.session)
    .refine(AvailabilityValidation.closure);
  static project(): { version: string; schemas: Record<string, object> } {
    const schemas: Record<string, object> = {};
    for (const name of ['offer', 'create', 'refresh', 'session'] as const)
      schemas[name] = z.toJSONSchema(this[name]);
    return { version: this.version, schemas };
  }
}
export type ProviderCapabilityOffer = z.infer<typeof ProviderAvailabilitySchemas.offer>;
export type ProviderAvailabilityCreate = z.infer<typeof ProviderAvailabilitySchemas.create>;
export type ProviderAvailabilityRefresh = z.infer<typeof ProviderAvailabilitySchemas.refresh>;
export type ProviderAvailabilitySession = z.infer<typeof ProviderAvailabilitySchemas.session>;
export type ProviderExecutionAdapter = z.infer<typeof ProviderAvailabilitySchemas.adapter>;
export type ProviderAvailabilityLane = z.infer<typeof ProviderAvailabilitySchemas.lane>;
export type ProviderAvailabilityLaneSnapshot = z.infer<
  typeof ProviderAvailabilitySchemas.laneSnapshot
>;
export type ProviderAvailabilitySnapshot = z.infer<typeof ProviderAvailabilitySchemas.snapshot>;
export type ProviderCapabilityConformance = z.infer<typeof ProviderAvailabilitySchemas.conformance>;
