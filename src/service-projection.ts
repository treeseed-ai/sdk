import { z } from 'zod';
import { PlatformSchemas, ProviderV4Schemas, ServiceSchemas, InstalledSchemas } from './schemas.js';
export class ServiceProjectionSchemas {
    static readonly ownSecret = z.strictObject({ slot: PlatformSchemas.slot });
    static readonly dependencySecret = this.ownSecret.extend({ dependencyPort: ProviderV4Schemas.declaration.shape.id });
    static readonly secret = z.strictObject({ $secret: z.union([this.ownSecret, this.dependencySecret]) });
    static readonly endpoint = z.strictObject({ $endpoint: z.strictObject({ dependencyPort: ProviderV4Schemas.declaration.shape.id, portId: ServiceSchemas.serviceId, scheme: z.enum(['http', 'https', 'tcp']), path: ServiceSchemas.endpoint.shape.path, part: z.enum(['url', 'host', 'port', 'authority']) }) });
    static readonly context = z.strictObject({ $context: z.enum(['installationId', 'origin', 'hostname', 'originAuthority', 'originPort', 'ownerUid', 'assetDigest']) });
    static readonly resources = ServiceSchemas.service.shape.resources.extend({ grants: z.array(z.strictObject({ dependencyPort: ProviderV4Schemas.declaration.shape.id, slot: PlatformSchemas.slot })).max(256).default([]), slots: z.record(PlatformSchemas.slot, InstalledSchemas.slotDefinition) });
    static readonly definition = ServiceSchemas.definition.extend({ environment: z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/), z.union([z.string().max(4096), this.endpoint, this.context])) });
    static readonly contract = z.strictObject({ port: ProviderV4Schemas.declaration.shape.id, contractId: ProviderV4Schemas.declaration.shape.id, contractVersion: PlatformSchemas.version });
    static readonly container = z.strictObject({ definition: this.definition, resources: this.resources, providedContracts: z.array(this.contract).min(1).max(64), dependencies: z.array(this.contract).max(256), observationContract: ProviderV4Schemas.declaration.shape.id, transitionPolicy: ServiceSchemas.service.shape.transitionPolicy });
}
export type ContainerProjection = z.infer<typeof ServiceProjectionSchemas.container>;
export type ServiceSecretProjection = z.infer<typeof ServiceProjectionSchemas.secret>;
export type ServiceEndpointProjection = z.infer<typeof ServiceProjectionSchemas.endpoint>;
