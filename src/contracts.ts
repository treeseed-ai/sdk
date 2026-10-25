export * from './service-journal.js';
export * from './management.js';
import { ServiceWorkerSchemas } from './service-journal.js';
import { PluginManagementSchemas } from './management.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { CanonicalJson as PortableJson, PlatformOperations, PlatformSchemas, InstalledSchemas, ProviderSchemas, ServiceSchemas, ProviderV4Schemas } from './schemas.js';
export * from './schemas.js';
export class CanonicalJson extends PortableJson {
  static digest(value:unknown):string {return createHash('sha256').update(this.stringify(value)).digest('hex');}
}
export class ContractProjection {
  static generate():object {
    PlatformOperations.validate(PlatformOperations.all);
    const operations=[];
    for(const binding of PlatformOperations.all) {
      const {input,output,...metadata}=binding.definition;
      operations.push({...metadata,input:z.toJSONSchema(input,{io:'input'}),output:z.toJSONSchema(output)});
    }
    const contract={contractVersion:'0.5.0-cordis.1',operations,schemas:{serviceApplication:z.toJSONSchema(ServiceSchemas.applicationRecord),serviceStatus:z.toJSONSchema(ServiceSchemas.status),serviceResource:z.toJSONSchema(ServiceSchemas.resourceReceipt),serviceSnapshot:z.toJSONSchema(ServiceSchemas.snapshot),serviceWorkerRequest:z.toJSONSchema(ServiceWorkerSchemas.request),serviceWorkerResponse:z.toJSONSchema(ServiceWorkerSchemas.response),pluginRequestRecord:z.toJSONSchema(ServiceWorkerSchemas.requestRecord),pluginInstall:z.toJSONSchema(PluginManagementSchemas.install,{io:'input'}),pluginSelect:z.toJSONSchema(PluginManagementSchemas.select,{io:'input'}),pluginResult:z.toJSONSchema(PluginManagementSchemas.result),pluginSourceReceipt:z.toJSONSchema(PluginManagementSchemas.sourceReceipt),pluginPackage:z.toJSONSchema(PluginManagementSchemas.packageDescriptor),managedHelpers:z.toJSONSchema(PluginManagementSchemas.helperInventory),pluginEnvelope:z.toJSONSchema(PluginManagementSchemas.envelope),serviceGraph:z.toJSONSchema(ServiceSchemas.graph),servicePlan:z.toJSONSchema(ServiceSchemas.plan),providerV4:z.toJSONSchema(ProviderV4Schemas.declaration),preparedProviderV2:z.toJSONSchema(ProviderV4Schemas.manifest),containerDefinition:z.toJSONSchema(InstalledSchemas.definition),installedPlan:z.toJSONSchema(InstalledSchemas.plan),installedRelease:z.toJSONSchema(InstalledSchemas.release),service:z.toJSONSchema(InstalledSchemas.service),workerRequest:z.toJSONSchema(InstalledSchemas.request),applicationRecord:z.toJSONSchema(InstalledSchemas.applicationRecord),installationReceipt:z.toJSONSchema(InstalledSchemas.receipt),configuration:z.toJSONSchema(PlatformSchemas.desired,{io:'input'}),release:z.toJSONSchema(PlatformSchemas.release),recipe:z.toJSONSchema(PlatformSchemas.recipe),plugin:z.toJSONSchema(PlatformSchemas.pluginDefinition),provider:z.toJSONSchema(ProviderSchemas.declaration),selection:z.toJSONSchema(ProviderSchemas.selection),preparedProvider:z.toJSONSchema(ProviderSchemas.manifest)}};
    return {...contract,digest:createHash('sha256').update(JSON.stringify(contract)).digest('hex')};
  }
}
