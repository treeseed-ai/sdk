export * from './capacity.js';
import { CapacitySchemas } from './capacity.js';
export * from './environments.js';
import { EnvironmentSchemas } from './environments.js';
export * from './activities.js';
import { ActivitySchemas } from './activities.js';
export * from './seeds.js';
import { SeedSchemas } from './seeds.js';
export * from './agent.js';
import { AgentSchemas } from './agent.js';
export * from './service-projection.js';
import {ServiceProjectionSchemas} from './service-projection.js';
export * from './service-journal.js';
export * from './management.js';
import { ServiceWorkerSchemas } from './service-journal.js';
import { PluginManagementSchemas } from './management.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { CanonicalJson as PortableJson, PlatformOperations, PlatformSchemas, InstalledSchemas, ProviderSchemas, ServiceSchemas, SourceAcquisitionSchemas, ProviderV4Schemas } from './schemas.js';
export * from './schemas.js';
export class CanonicalJson extends PortableJson {
  static digest(value:unknown):string {return createHash('sha256').update(this.stringify(value)).digest('hex');}
}
export class ContractProjection {
  private static readonly outputSchemas = {
    capacityLease: CapacitySchemas.lease,
    capacityReadiness: CapacitySchemas.readiness,
    capacityResult: CapacitySchemas.result,

    environmentDefinition: EnvironmentSchemas.definition,

    activityCatalogue: ActivitySchemas.catalogue,
    activityProfile: ActivitySchemas.instance,
    agentDefinition: ActivitySchemas.definition,
    agentAuthority: AgentSchemas.authority,
    agentExecutionRequest: AgentSchemas.request,
    agentExecutionResult: AgentSchemas.result,
    sourceLiveTransition: SourceAcquisitionSchemas.liveTransition,
    sourceAcquisitionPolicy: SourceAcquisitionSchemas.policy,
    sourceBuildPolicy: SourceAcquisitionSchemas.build,
    runtimeContent: ServiceSchemas.runtimeContent,
    runtimeBinding: ServiceSchemas.runtimeBinding,
    observationContext: ServiceSchemas.observationContext,
    runtimeEvidence: ServiceSchemas.runtimeEvidence,
    containerProjection: ServiceProjectionSchemas.container,
    serviceEnvelope: ServiceSchemas.envelope,
    serviceApplication: ServiceSchemas.applicationRecord,
    serviceStatus: ServiceSchemas.status,
    serviceResource: ServiceSchemas.resourceReceipt,
    serviceSnapshot: ServiceSchemas.snapshot,
    serviceWorkerRequest: ServiceWorkerSchemas.request,
    serviceWorkerResponse: ServiceWorkerSchemas.response,
    pluginRequestRecord: ServiceWorkerSchemas.requestRecord,
    pluginResult: PluginManagementSchemas.result,
    pluginSourceReceipt: PluginManagementSchemas.sourceReceipt,
    pluginPackage: PluginManagementSchemas.packageDescriptor,
    managedHelpers: PluginManagementSchemas.helperInventory,
    pluginEnvelope: PluginManagementSchemas.envelope,
    serviceGraph: ServiceSchemas.graph,
    servicePlan: ServiceSchemas.plan,
    providerV4: ProviderV4Schemas.declaration,
    preparedProviderV2: ProviderV4Schemas.manifest,
    containerDefinition: InstalledSchemas.definition,
    installedPlan: InstalledSchemas.plan,
    installedRelease: InstalledSchemas.release,
    service: InstalledSchemas.service,
    workerRequest: InstalledSchemas.request,
    applicationRecord: InstalledSchemas.applicationRecord,
    installationReceipt: InstalledSchemas.receipt,
    release: PlatformSchemas.release,
    recipe: PlatformSchemas.recipe,
    plugin: PlatformSchemas.pluginDefinition,
    provider: ProviderSchemas.declaration,
    selection: ProviderSchemas.selection,
    preparedProvider: ProviderSchemas.manifest,
    seedBundle: SeedSchemas.bundle,
    seedPlan: SeedSchemas.plan,
    seedReceipt: SeedSchemas.receipt,
    seedResourcePlan: SeedSchemas.resourcePlan,
    seedResourceReceipt: SeedSchemas.resourceReceipt,
  };
  private static readonly inputSchemas = {
    pluginInstall: PluginManagementSchemas.install,
    pluginSelect: PluginManagementSchemas.select,
    configuration: PlatformSchemas.desired,
  };

  private static operations(): object[] {
    const operations = [];
    for (const binding of PlatformOperations.all) {
      const { input, output, ...metadata } = binding.definition;
      operations.push({
        ...metadata,
        input: z.toJSONSchema(input, { io: 'input' }),
        output: z.toJSONSchema(output),
      });
    }
    return operations;
  }

  private static schemas(): Record<string, object> {
    const result: Record<string, object> = {};
    for (const [name, schema] of Object.entries(this.outputSchemas))
      result[name] = z.toJSONSchema(schema);
    for (const [name, schema] of Object.entries(this.inputSchemas)) {
      result[name] = z.toJSONSchema(schema, { io: 'input' });
    }
    return result;
  }

  static generate(): object {
    PlatformOperations.validate(PlatformOperations.all);
    const contract = {
      contractVersion: '0.6.0-cordis.1',
      operations: this.operations(),
      schemas: this.schemas(),
    };
    return {
      ...contract,
      digest: createHash('sha256').update(JSON.stringify(contract)).digest('hex'),
    };
  }
}
