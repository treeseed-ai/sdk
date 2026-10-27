import { z } from 'zod';
import { PackageDefinition, ProviderV4Schemas } from '../../src/contracts.js';
import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
export class ConfigurationPredicates {
    static allowed(value: string): boolean { return value !== 'forbidden'; }
}
export class AnnotatedConfigurationPlugin {
    static readonly provide = ['fixture.configuration'];
    static readonly inject: string[] = [];
    static readonly Config = z.strictObject({ value: z.string().meta({ type: 'number' }) });
    static readonly declaration = ProviderV4Schemas.declaration.parse({ id: 'fixture.configuration', pluginId: 'fixture', capability: 'fixture.configuration', target: 'deployment', contractVersion: ProviderV4Schemas.version, provide: this.provide, inject: this.inject });
    static readonly replacement = { kind: 'restart', stateVersion: 1, qualificationDigest: null };
}
export class RefinedConfigurationPlugin {
    static readonly provide = AnnotatedConfigurationPlugin.provide;
    static readonly inject = AnnotatedConfigurationPlugin.inject;
    static readonly Config = z.strictObject({ value: z.string().refine(ConfigurationPredicates.allowed) });
    static readonly declaration = AnnotatedConfigurationPlugin.declaration;
    static readonly replacement = AnnotatedConfigurationPlugin.replacement;
}
