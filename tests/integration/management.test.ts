import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
class ManagementTestsIntegration {

    async results(): Promise<void> { const { PluginManagementSchemas } = await import('../../src/management.js'); const blocked = { requestId: 'request-1', pluginId: null, artifact: null, target: null, planId: null, applicationId: null, previousGeneration: null, activeGeneration: null, state: 'blocked', blockers: [{ code: 'TRUST_REQUIRED', message: 'Review publisher.' }], nextActions: ['review-trust'], acknowledgements: [] }; expect(PluginManagementSchemas.result.safeParse(blocked).success).toBe(true); expect(PluginManagementSchemas.result.safeParse({ ...blocked, state: 'active', blockers: [] }).success).toBe(false); expect(PluginManagementSchemas.install.safeParse({ source: '@owner/plugin', idempotencyKey: 'request-1', installationDirectory: '/tmp/installation', scope: 'installation', configuration: {}, grants: ['admin'] }).success).toBe(false); }
}
class ManagementEnvelopeTestsIntegration {

    async refusal(): Promise<void> { const { PluginManagementSchemas } = await import('../../src/management.js'); const result = { requestId: 'request-1', pluginId: 'fixture', artifact: { package: '@fixture/provider', version: '1.0.0', integrity: 'a'.repeat(64) }, target: 'cli', planId: 'plan-fixture', applicationId: 'app-fixture', previousGeneration: null, activeGeneration: null, state: 'prepared', blockers: [], nextActions: ['authorize-restart'], acknowledgements: [] }; expect(PluginManagementSchemas.envelope.safeParse({ command: 'plugin.install', success: true, result, problem: null, blockers: [], references: [] }).success).toBe(false); }
}
class PackageMetadataTestsIntegration {

    async acknowledged(): Promise<void> { const { PluginManagementSchemas } = await import('../../src/management.js'); const digest = 'a'.repeat(64), result = { requestId: 'r', pluginId: 'fixture', artifact: { package: '@fixture/plugin', version: '1.0.0', integrity: digest }, target: 'cli', planId: 'plan-' + digest, applicationId: 'app-' + digest, previousGeneration: null, activeGeneration: digest, state: 'active', blockers: [], nextActions: [], acknowledgements: [{ target: 'cli', scopeId: 'client', generation: digest, ready: true }] }; expect(PluginManagementSchemas.result.safeParse(result).success).toBe(true); expect(PluginManagementSchemas.result.safeParse({ ...result, acknowledgements: [{ ...result.acknowledgements[0], generation: 'b'.repeat(64) }] }).success).toBe(false); }
}
const suite=new ManagementTestsIntegration();
const envelope=new ManagementEnvelopeTestsIntegration();
const packageMetadata=new PackageMetadataTestsIntegration();
test('integration: management results cannot fabricate accepted activation or authority', suite.results.bind(suite));
test('integration: prepared installation cannot be a successful install envelope', envelope.refusal.bind(envelope));
test('integration: active install result requires exact target generation acknowledgement', packageMetadata.acknowledged.bind(packageMetadata));
