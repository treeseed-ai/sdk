import { z } from 'zod';
import { PlatformSchemas, ProviderV4Schemas, ServiceSchemas, CanonicalJson } from './schemas.js';
export type PluginLocator = {
    kind: 'npm';
    name: string;
    selector: string;
} | {
    kind: 'git';
    url: string;
    ref: string | null;
};
/** Syntax only. Resolution, publisher trust and execution belong to Deployment. */
export class PluginSource {
    static parse(value: string): PluginLocator {
        if (typeof value !== 'string' || value.length < 1 || value.length > 2048 || value !== value.trim() || /[\x00-\x1f\x7f]/.test(value))
            throw new Error('INVALID_PLUGIN_SOURCE');
        if (value.startsWith('https://')) {
            try {
                const url = new URL(value), ref = url.hash ? decodeURIComponent(url.hash.slice(1)) : null;
                if (url.protocol !== 'https:' || url.username || url.password || url.search || !url.hostname || !/^\/(?:[a-zA-Z0-9][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\.git)?$/.test(url.pathname) || /\.(tgz|zip|gz)$/.test(url.pathname) || value.includes('%') || /(?:^|\/)\.{1,2}(?:\/|#|$)/.test(value) || value.endsWith('#') || (ref !== null && (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(ref) || ref.includes('..') || ref.includes('/.') || ref.endsWith('/') || ref.endsWith('.') || ref.endsWith('.lock'))))
                    throw new Error();
                return { kind: 'git', url: url.origin + url.pathname, ref };
            }
            catch {
                throw new Error('INVALID_PLUGIN_SOURCE');
            }
        }
        const match = /^((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)(?:@([a-zA-Z0-9*^~<>=][a-zA-Z0-9.*^~<>=|+_ -]*))?$/.exec(value);
        if (!match || /\s--?[a-zA-Z]/.test(value) || match[1]!.length > 214 || match[2]?.endsWith(' '))
            throw new Error('INVALID_PLUGIN_SOURCE');
        return { kind: 'npm', name: match[1]!, selector: match[2] ?? 'latest' };
    }
    static valid(value: string): boolean { try {
        PluginSource.parse(value);
        return true;
    }
    catch {
        return false;
    } }
    static https(value: string): boolean { try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
    }
    catch {
        return false;
    } }
}
class ManagementValidation {
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
        assets: Array<{
            path: string;
        }>;
    }): boolean { const ids = new Set<string>(), commands = new Set<string>(), assets = new Set<string>(); for (const provider of value.providers) {
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
    } for (const asset of value.assets) {
        if (assets.has(asset.path))
            return false;
        assets.add(asset.path);
    } return true; }
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
    }): boolean { if (value.success) {
        if (value.problem !== null || value.result === null || value.blockers.length)
            return false;
        if (value.command === 'plugin.install' || value.command === 'plugin.select')
            return !Array.isArray(value.result) && ['active', 'already-active'].includes(value.result.state);
        return value.command === 'plugin.list' ? Array.isArray(value.result) : !Array.isArray(value.result);
    } return value.problem !== null && (value.result === null || (!Array.isArray(value.result) && !['active', 'already-active'].includes(value.result.state))); }
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
    static readonly install = z.strictObject({ source: this.source, idempotencyKey: this.key, installationDirectory: PlatformSchemas.absolute, scope: this.scope, target: this.target.optional(), providerId: ProviderV4Schemas.declaration.shape.id.optional(), expectedGeneration: PlatformSchemas.digest.nullable().optional(), configuration: z.record(z.string(), z.json()).default({}) });
    static readonly select = z.strictObject({ capability: ProviderV4Schemas.declaration.shape.capability, providerId: ProviderV4Schemas.declaration.shape.id, idempotencyKey: this.key, installationDirectory: PlatformSchemas.absolute, scope: this.scope, target: this.target, expectedGeneration: PlatformSchemas.digest.nullable().optional(), configuration: z.record(z.string(), z.json()).default({}) });
    static readonly replacement = z.strictObject({ kind: z.enum(['live', 'restart', 'migration']), stateVersion: z.number().int().positive(), qualificationDigest: PlatformSchemas.digest.nullable() }).refine(ManagementValidation.policy);
    static readonly container = z.strictObject({ definition: ServiceSchemas.definition, resources: ServiceSchemas.service.shape.resources, providedContracts: z.array(z.strictObject({ port: ProviderV4Schemas.declaration.shape.id, contractId: ProviderV4Schemas.declaration.shape.id, contractVersion: PlatformSchemas.version })).min(1).max(64), dependencies: z.array(z.strictObject({ port: ProviderV4Schemas.declaration.shape.id, contractId: ProviderV4Schemas.declaration.shape.id, contractVersion: PlatformSchemas.version })).max(256), observationContract: ProviderV4Schemas.declaration.shape.id, transitionPolicy: ServiceSchemas.service.shape.transitionPolicy });
    static readonly provider = z.strictObject({ declaration: ProviderV4Schemas.declaration, entry: PlatformSchemas.relative, classExport: ProviderV4Schemas.manifest.shape.classExport, configurationSchema: z.record(z.string(), z.json()).refine(ManagementValidation.configuration), replacement: this.replacement, commandIds: z.array(ProviderV4Schemas.declaration.shape.id).refine(ManagementValidation.unique), container: this.container.optional(), probe: z.strictObject({ observationContracts: z.array(ProviderV4Schemas.declaration.shape.id).min(1).refine(ManagementValidation.unique), schemes: z.array(z.enum(['http', 'https', 'tcp'])).min(1), maximumDeadlineMs: z.number().int().min(1).max(120000) }).optional() });
    static readonly asset = PlatformSchemas.file.extend({ size: z.number().int().nonnegative().max(64 * 1024 * 1024) });
    static readonly packageDescriptor = z.strictObject({ formatVersion: z.literal(4), contractVersion: z.literal('0.4.0-cordis.1'), pluginId: ProviderV4Schemas.declaration.shape.pluginId, package: z.strictObject({ name: PlatformSchemas.packageName, version: PlatformSchemas.version }), providers: z.array(this.provider).min(1).max(256), assets: z.array(this.asset).max(4096) }).refine(ManagementValidation.descriptor);
    static readonly helper = z.strictObject({ id: PlatformSchemas.slot, version: PlatformSchemas.version, platform: z.literal('linux-amd64'), url: z.string().refine(PluginSource.https), sha256: PlatformSchemas.digest, size: z.number().int().positive().max(512 * 1024 * 1024), entry: PlatformSchemas.relative, files: z.array(PlatformSchemas.file.extend({ mode: z.union([z.literal(0o400), z.literal(0o500)]) })).min(1).max(8192), libraryDirectories: z.array(PlatformSchemas.relative).max(64), executableDirectory: PlatformSchemas.relative.optional() });
    static readonly helperInventory = z.strictObject({ formatVersion: z.literal(1), releaseIdentity: PlatformSchemas.digest, helpers: z.array(this.helper).min(1).max(16) });
    static readonly receiptCommon = z.strictObject({ locator: this.source, name: PlatformSchemas.packageName, version: PlatformSchemas.version, archiveDigest: PlatformSchemas.digest, sri: z.string().regex(/^sha(?:256|512)-[a-zA-Z0-9+/]+=*$/), closureDigest: PlatformSchemas.digest, helperDigests: z.array(PlatformSchemas.digest).min(1).max(16) });
    static readonly sourceReceipt = z.discriminatedUnion('kind', [this.receiptCommon.extend({ kind: z.literal('npm'), registry: z.string().refine(PluginSource.https) }), this.receiptCommon.extend({ kind: z.literal('git'), origin: z.string().refine(PluginSource.https), commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/), tree: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/), buildPolicyDigest: PlatformSchemas.digest.nullable() })]);
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
export class PackageDefinition {
    static export(plugin: NativeDescriptorClass, entry: string, classExport: string): PluginExportDescriptor { const declaration = ProviderV4Schemas.declaration.parse(plugin.declaration), provided = typeof plugin.provide === 'string' ? [plugin.provide] : [...plugin.provide]; if (CanonicalJson.stringify(provided.sort()) !== CanonicalJson.stringify([...declaration.provide].sort()) || CanonicalJson.stringify([...plugin.inject].sort()) !== CanonicalJson.stringify([...declaration.inject].sort()))
        throw new Error('PACKAGE_DECLARATION_DRIFT'); return PluginManagementSchemas.provider.parse({ declaration, entry, classExport, configurationSchema: z.toJSONSchema(plugin.Config, { io: 'input', unrepresentable: 'throw' }), replacement: plugin.replacement, commandIds: plugin.commandIds ?? [], ...plugin.container ? { container: plugin.container } : {}, ...plugin.probe ? { probe: plugin.probe } : {} }); }
    static define(name: string, version: string, pluginId: string, providers: PluginExportDescriptor[], assets: PluginPackageDescriptor['assets'] = []): PluginPackageDescriptor { return PluginManagementSchemas.packageDescriptor.parse({ formatVersion: 4, contractVersion: '0.4.0-cordis.1', package: { name, version }, pluginId, providers, assets }); }
}
