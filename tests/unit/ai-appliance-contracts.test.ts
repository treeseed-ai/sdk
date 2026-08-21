import { describe,expect,it } from 'vitest';
import { AI_APPLIANCE_SCHEMA_VERSION,DEFAULT_AI_CONTROL_PLANE_URL,DEFAULT_AI_GATEWAY_URL,validateAiApplianceManifest,validateExecutionProviderModuleManifest } from '../../src/ai-appliance/index.ts';

describe('AI appliance contracts', () => {
	it('accepts the joined constrained-hardware profile', () => {
		const result = validateAiApplianceManifest({
			schemaVersion: AI_APPLIANCE_SCHEMA_VERSION, mode: 'joined',
			management: { socket: '/run/treeseed-ai/manager.sock' },
			controlPlane: { enabled: true, url: DEFAULT_AI_CONTROL_PLANE_URL, audience: DEFAULT_AI_CONTROL_PLANE_URL },
			inference: { publicAlias: 'treeseed-qwen3.5-4b', model: 'Qwen/Qwen3.5-4B', gatewayUrl: DEFAULT_AI_GATEWAY_URL, rawVllmUrl: 'http://vllm:8000', maxModelLength: 16_384, maxConcurrentSequences: 1, gpuMemoryUtilization: 0.85 },
			providers: { agent: { enabled: true, manifest: '/etc/treeseed/ai/providers/agent.yaml' }, platformOperation: { enabled: true, manifest: '/etc/treeseed/ai/providers/platform-operation.yaml' } },
		});
		expect(result).toEqual({ ok: true, diagnostics: [] });
	});

	it('requires an active local control plane in standalone mode', () => {
		const result = validateAiApplianceManifest({ schemaVersion: AI_APPLIANCE_SCHEMA_VERSION, mode: 'standalone', management: { socket: '/run/a.sock' }, controlPlane: { enabled: true, url: DEFAULT_AI_CONTROL_PLANE_URL, audience: DEFAULT_AI_CONTROL_PLANE_URL }, inference: { publicAlias: 'model', model: 'model', gatewayUrl: DEFAULT_AI_GATEWAY_URL, rawVllmUrl: 'http://vllm:8000', maxModelLength: 1024, maxConcurrentSequences: 1, gpuMemoryUtilization: 0.8 }, providers: { agent: { enabled: false, manifest: '' }, platformOperation: { enabled: false, manifest: '' } } });
		expect(result.diagnostics.map((entry) => entry.code)).toContain('ai_appliance_local_control_plane_required');
	});

	it('rejects unsafe or mutable module descriptors', () => {
		const result = validateExecutionProviderModuleManifest({ schemaVersion: 'treeseed.execution-provider/v1', apiVersion: 'treeseed.execution-provider/v1', id: 'fixture', package: 'fixture', version: '1.0.0', entrypoint: '../index.js', adapters: ['fixture'], permissions: { network: [], credentials: [] }, digest: 'sha256:not-exact' });
		expect(result.ok).toBe(false);
		expect(result.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining(['execution_provider_module_entrypoint_unsafe', 'execution_provider_module_digest_invalid']));
	});
});
