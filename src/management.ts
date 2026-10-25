import { z } from 'zod';
import { PlatformSchemas, ProviderV4Schemas, SourceToolSchemas, CanonicalJson, ServiceSchemas } from './schemas.js';
export { PluginSource, type PluginLocator } from './plugin-source.js';
import { PluginSource } from './plugin-source.js';
import { ServiceProjectionSchemas } from './service-projection.js';
class ManagementValidation {
    static bindings(value:Record<string,string>):boolean{return Object.keys(value).length<=256;}
    static serviceIntent(value:{scope:string;target?:string;serviceId?:string;bindings?:Record<string,string>}):boolean{return value.serviceId===undefined&&value.bindings===undefined||value.scope==='installation'&&value.target==='deployment';}
    static image(value: {
        reference: string;
        manifestDigest: string;
    }): boolean { return value.reference.endsWith('@sha256:' + value.manifestDigest) && !value.reference.split('@')[0]!.split('/').at(-1)!.includes(':'); }
    static unique(values: string[]): boolean { return new Set(values).size === values.length; }
    static descriptor(value: {
        pluginId: string;
        providers: Array<{
            declaration: {
                pluginId: string;
                target: string;
                id: string;
                capability: string;
            };
            commandIds: string[];
        }>;
        images: Array<{
            id: string;
            reference: string;
        }>;
        assets: Array<{
            path: string;
        }>;
        runtimeImages?: Array<{id:string;entry:string}>;
    }): boolean {
        const ids = new Set<string>(), commands = new Set<string>(), assets = new Set<string>();
        for (const provider of value.providers) {
            const identity = provider.declaration.target + ':' + provider.declaration.id;
            if (provider.declaration.pluginId !== value.pluginId || ids.has(identity))
                return false;
            ids.add(identity);
            for (const command of provider.commandIds) {
                const key = provider.declaration.target + ':' + command;
                if (commands.has(key))
                    return false;
                commands.add(key);
            }
        }
        for (const asset of value.assets) {
            if (assets.has(asset.path))
                return false;
            assets.add(asset.path);
        }
        const imageIds = new Set<string>();
        for (const image of value.images) {
            if (imageIds.has(image.id))
                return false;
            imageIds.add(image.id);
        }
        for (const image of value.runtimeImages ?? []) { if (imageIds.has(image.id)) return false; imageIds.add(image.id); }
        return true;
    }
    static configuration(value: Record<string, unknown>): boolean { return value.type === 'object' && value.additionalProperties === false; }
    static policy(value: {
        kind: string;
        qualificationDigest: string | null;
    }): boolean { return value.kind !== 'live' || value.qualificationDigest !== null; }
    static envelope(value: {
        command: string;
        success: boolean;
        result: {
            state: string;
        } | Array<{
            state: string;
        }> | null;
        problem: unknown;
        blockers: unknown[];
    }): boolean {
        if (value.success) {
            if (value.problem !== null || value.result === null || value.blockers.length)
                return false;
            if (value.command === 'plugin.install' || value.command === 'plugin.select')
                return !Array.isArray(value.result) && ['active', 'already-active'].includes(value.result.state);
            return value.command === 'plugin.list' ? Array.isArray(value.result) : !Array.isArray(value.result);
        }
        return value.problem !== null && (value.result === null || (!Array.isArray(value.result) && !['active', 'already-active'].includes(value.result.state)));
    }
    static result(value: {
        state: string;
        pluginId: string | null;
        artifact: unknown;
        target: string | null;
        planId: string | null;
        applicationId: string | null;
        previousGeneration: string | null;
        activeGeneration: string | null;
        blockers: unknown[];
        nextActions: string[];
        acknowledgements: Array<{
            target: string;
            generation: string;
            ready: boolean;
        }>;
    }): boolean {
        if ((value.pluginId === null) !== (value.artifact === null))
            return false;
        if (value.artifact === null && (value.planId !== null || value.applicationId !== null || value.acknowledgements.length > 0))
            return false;
        if (value.state === 'active' || value.state === 'already-active') {
            if (value.pluginId === null || value.target === null || value.activeGeneration === null || value.planId === null || value.applicationId === null || value.blockers.length || value.nextActions.length || !value.acknowledgements.length)
                return false;
            for (const acknowledgement of value.acknowledgements)
                if (!acknowledgement.ready || acknowledgement.target !== value.target || acknowledgement.generation !== value.activeGeneration)
                    return false;
        }
        if (value.state === 'pending' && (value.planId === null || value.applicationId === null))
            return false;
        return true;
    }
}
export class PluginManagementSchemas {
    static readonly key = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
    static readonly source = z.string().min(1).max(2048).refine(PluginSource.valid);
    static readonly target = ProviderV4Schemas.target;
    static readonly scope = z.enum(['installation', 'client']);
    static readonly serviceIntentMetadata={allOf:[{if:{anyOf:[{required:['serviceId']},{required:['bindings']}]},then:{properties:{scope:{const:'installation'},target:{const:'deployment'}},required:['target']}}]};
    static readonly install = z.strictObject({ source: this.source,serviceId:ServiceSchemas.serviceId.optional(),bindings:z.record(ProviderV4Schemas.declaration.shape.id,ProviderV4Schemas.declaration.shape.id).refine(ManagementValidation.bindings).meta({maxProperties:256}).optional(), idempotencyKey: this.key, installationDirectory: PlatformSchemas.absolute, scope: this.scope, target: this.target.optional(), providerId: ProviderV4Schemas.declaration.shape.id.optional(), expectedGeneration: PlatformSchemas.digest.nullable().optional(), configuration: z.record(z.string(), z.json()).default({}) }).refine(ManagementValidation.serviceIntent).meta(this.serviceIntentMetadata);
    static readonly select = z.strictObject({ capability: ProviderV4Schemas.declaration.shape.capability, providerId: ProviderV4Schemas.declaration.shape.id,serviceId:ServiceSchemas.serviceId.optional(), idempotencyKey: this.key, installationDirectory: PlatformSchemas.absolute, scope: this.scope, target: this.target, expectedGeneration: PlatformSchemas.digest.nullable().optional(), configuration: z.record(z.string(), z.json()).default({}) }).refine(ManagementValidation.serviceIntent).meta(this.serviceIntentMetadata);
    static readonly replacement = z.strictObject({ kind: z.enum(['live', 'restart', 'migration']), stateVersion: z.number().int().positive(), qualificationDigest: PlatformSchemas.digest.nullable() }).refine(ManagementValidation.policy);
    static readonly container = ServiceProjectionSchemas.container;
    static readonly provider = z.strictObject({ declaration: ProviderV4Schemas.declaration, entry: PlatformSchemas.relative, classExport: ProviderV4Schemas.manifest.shape.classExport, configurationSchema: z.record(z.string(), z.json()).refine(ManagementValidation.configuration), replacement: this.replacement, commandIds: z.array(ProviderV4Schemas.declaration.shape.id).refine(ManagementValidation.unique), container: this.container.optional(), probe: z.strictObject({ observationContracts: z.array(ProviderV4Schemas.declaration.shape.id).min(1).refine(ManagementValidation.unique), schemes: z.array(z.enum(['http', 'https', 'tcp'])).min(1), maximumDeadlineMs: z.number().int().min(1).max(120000) }).optional() });
    static readonly asset = PlatformSchemas.file.extend({ size: z.number().int().nonnegative().max(64 * 1024 * 1024) });
    static readonly image = z.strictObject({ id: ProviderV4Schemas.declaration.shape.id, reference: PlatformSchemas.imageReference, source: z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('prepared')}),z.strictObject({ kind: z.literal('oci-archive'), url: z.string().refine(PluginSource.https), sha256: PlatformSchemas.digest, size: z.number().int().positive().max(2 * 1024 ** 3) })]), indexSha256: PlatformSchemas.digest, manifestDigest: PlatformSchemas.digest }).refine(ManagementValidation.image);
    static readonly packageDescriptor = z.strictObject({ formatVersion: z.literal(4), contractVersion: z.literal('0.4.0-cordis.1'), pluginId: ProviderV4Schemas.declaration.shape.pluginId, package: z.strictObject({ name: PlatformSchemas.packageName, version: PlatformSchemas.version }), providers: z.array(this.provider).min(1).max(256), assets: z.array(this.asset).max(4096), images: z.array(this.image).max(64).default([]), runtimeImages: z.array(z.strictObject({id:ProviderV4Schemas.declaration.shape.id,entry:PlatformSchemas.relative})).max(64).optional() }).refine(ManagementValidation.descriptor);
    static readonly helper = SourceToolSchemas.helper;
    static readonly helperInventory = SourceToolSchemas.helperInventory;
    static readonly receiptCommon = z.strictObject({ locator: this.source, name: PlatformSchemas.packageName, version: PlatformSchemas.version, archiveDigest: PlatformSchemas.digest, sri: z.string().regex(/^sha(?:256|512)-[a-zA-Z0-9+/]+=*$/), closureDigest: PlatformSchemas.digest, helperDigests: z.array(PlatformSchemas.digest).min(1).max(16) });
    static readonly sourceReceipt = z.discriminatedUnion('kind', [this.receiptCommon.extend({ kind: z.literal('npm'), registry: z.string().refine(PluginSource.https) }), this.receiptCommon.extend({ kind: z.literal('git'), origin: z.string().refine(PluginSource.https), commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/), tree: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/), buildPolicyDigest: PlatformSchemas.digest.nullable() })]);
    static readonly resolution = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('npm'), registry: z.string().refine(PluginSource.https), name: PlatformSchemas.packageName, version: PlatformSchemas.version, tarball: z.string().refine(PluginSource.https), sri: z.string().regex(/^sha(?:256|512)-[a-zA-Z0-9+/]+=*$/), metadataDigest: PlatformSchemas.digest, helperDigests: z.array(PlatformSchemas.digest).min(1).max(16) }), z.strictObject({ kind: z.literal('git'), origin: z.string().refine(PluginSource.https), commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/), helperDigests: z.array(PlatformSchemas.digest).min(1).max(16) })]);
    static readonly acknowledgement = z.strictObject({ target: this.target, scopeId: this.key, generation: PlatformSchemas.digest, ready: z.boolean() });
    static readonly result = z.strictObject({ requestId: this.key, pluginId: ProviderV4Schemas.declaration.shape.pluginId.nullable(), artifact: PlatformSchemas.artifact.nullable(), target: this.target.nullable(), planId: PlatformSchemas.text.nullable(), applicationId: PlatformSchemas.text.nullable(), previousGeneration: PlatformSchemas.digest.nullable(), activeGeneration: PlatformSchemas.digest.nullable(), state: z.enum(['active', 'already-active', 'prepared', 'pending', 'blocked', 'recovery-required']), blockers: z.array(PlatformSchemas.blocker), nextActions: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).refine(ManagementValidation.unique), acknowledgements: z.array(this.acknowledgement).max(16) }).refine(ManagementValidation.result);
    static readonly envelope = z.strictObject({ command: z.enum(['plugin.install', 'plugin.select', 'plugin.list', 'plugin.inspect']), success: z.boolean(), result: z.union([this.result, z.array(this.result)]).nullable(), problem: PlatformSchemas.problem.nullable(), blockers: z.array(PlatformSchemas.blocker), references: z.array(PlatformSchemas.text) }).refine(ManagementValidation.envelope);
}
export type PluginInstallRequest = z.infer<typeof PluginManagementSchemas.install>;
export type PluginSelectRequest = z.infer<typeof PluginManagementSchemas.select>;
export type PluginInstallResult = z.infer<typeof PluginManagementSchemas.result>;
export type PluginSourceReceipt = z.infer<typeof PluginManagementSchemas.sourceReceipt>;
export type PluginPackageDescriptor = z.infer<typeof PluginManagementSchemas.packageDescriptor>;
export type PluginExportDescriptor = z.infer<typeof PluginManagementSchemas.provider>;
export type ManagedHelperInventory = z.infer<typeof PluginManagementSchemas.helperInventory>;
export interface NativeDescriptorClass {
    readonly declaration: unknown;
    readonly provide: readonly string[] | string;
    readonly inject: readonly string[];
    readonly Config: z.ZodType;
    readonly replacement: unknown;
    readonly commandIds?: readonly string[];
    readonly container?: unknown;
    readonly probe?: unknown;
}
class ConfigurationProjection {
    static check(context: {
        zodSchema: z.core.$ZodType;
    }): void {
        const checks = context.zodSchema._zod.def.checks ?? [];
        for (const check of checks) {
            const kind = check._zod.def.check;
            if (!['less_than', 'greater_than', 'multiple_of', 'number_format', 'max_size', 'min_size', 'size_equals', 'max_length', 'min_length', 'length_equals', 'string_format', 'overwrite'].includes(kind))
                throw new Error('UNREPRESENTABLE_CONFIGURATION_SCHEMA');
        }
    }
    static generate(schema: z.ZodType): unknown { return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'throw', metadata: z.registry(), override: ConfigurationProjection.check }); }
}
export class PackageDefinition {
    static export(plugin: NativeDescriptorClass, entry: string, classExport: string): PluginExportDescriptor {
        const declaration = ProviderV4Schemas.declaration.parse(plugin.declaration), provided = typeof plugin.provide === 'string' ? [plugin.provide] : [...plugin.provide];
        if (CanonicalJson.stringify(provided.sort()) !== CanonicalJson.stringify([...declaration.provide].sort()) || CanonicalJson.stringify([...plugin.inject].sort()) !== CanonicalJson.stringify([...declaration.inject].sort()))
            throw new Error('PACKAGE_DECLARATION_DRIFT');
        return PluginManagementSchemas.provider.parse({ declaration, entry, classExport, configurationSchema: ConfigurationProjection.generate(plugin.Config), replacement: plugin.replacement, commandIds: plugin.commandIds ?? [], ...plugin.container ? { container: plugin.container } : {}, ...plugin.probe ? { probe: plugin.probe } : {} });
    }
    static define(name: string, version: string, pluginId: string, providers: PluginExportDescriptor[], assets: PluginPackageDescriptor['assets'] = [], images: PluginPackageDescriptor['images'] = [], runtimeImages?: PluginPackageDescriptor['runtimeImages']): PluginPackageDescriptor { return PluginManagementSchemas.packageDescriptor.parse({ formatVersion: 4, contractVersion: '0.4.0-cordis.1', package: { name, version }, pluginId, providers, assets, images, ...runtimeImages ? {runtimeImages} : {} }); }
}
