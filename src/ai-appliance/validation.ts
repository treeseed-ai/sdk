import {
	AI_APPLIANCE_SCHEMA_VERSION,
	EXECUTION_PROVIDER_MODULE_SCHEMA_VERSION,
	type AiApplianceDiagnostic,
	type AiApplianceManifest,
	type AiApplianceValidationResult,
	type ExecutionProviderModuleManifest,
	type ExecutionProviderRuntimeConfiguration,
} from './contracts.ts';

function text(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function diagnostic(diagnostics: AiApplianceDiagnostic[], code: string, path: string, message: string) {
	diagnostics.push({ code, path, severity: 'error', message });
}

function httpUrl(value: unknown) {
	if (!text(value)) return false;
	try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

function secretReference(value: unknown) {
	return text(value) && value.includes('://');
}

export function validateAiApplianceManifest(manifest: AiApplianceManifest): AiApplianceValidationResult {
	const diagnostics: AiApplianceDiagnostic[] = [];
	if (manifest?.schemaVersion !== AI_APPLIANCE_SCHEMA_VERSION) diagnostic(diagnostics, 'ai_appliance_schema_invalid', 'schemaVersion', `schemaVersion must be ${AI_APPLIANCE_SCHEMA_VERSION}.`);
	if (!['joined', 'standalone'].includes(manifest?.mode)) diagnostic(diagnostics, 'ai_appliance_mode_invalid', 'mode', 'mode must be joined or standalone.');
	if (!text(manifest?.management?.socket) || !manifest.management.socket.startsWith('/')) diagnostic(diagnostics, 'ai_appliance_management_socket_invalid', 'management.socket', 'management.socket must be an absolute path.');
	if (manifest?.management?.loopbackUrl && !httpUrl(manifest.management.loopbackUrl)) diagnostic(diagnostics, 'ai_appliance_management_url_invalid', 'management.loopbackUrl', 'management.loopbackUrl must be an HTTP URL.');
	if (!httpUrl(manifest?.marketGateway?.url) || !httpUrl(manifest?.marketGateway?.audience)) diagnostic(diagnostics, 'ai_appliance_market_url_invalid', 'marketGateway', 'Market gateway URL and audience must be HTTP URLs.');
	if (!text(manifest?.inference?.publicAlias) || !text(manifest?.inference?.model)) diagnostic(diagnostics, 'ai_appliance_model_required', 'inference', 'Inference model and public alias are required.');
	if (!httpUrl(manifest?.inference?.gatewayUrl) || !httpUrl(manifest?.inference?.rawVllmUrl)) diagnostic(diagnostics, 'ai_appliance_inference_url_invalid', 'inference', 'Inference gateway and raw vLLM URLs must be HTTP URLs.');
	if (!Number.isInteger(manifest?.inference?.maxModelLength) || manifest.inference.maxModelLength < 1024) diagnostic(diagnostics, 'ai_appliance_context_invalid', 'inference.maxModelLength', 'maxModelLength must be an integer of at least 1024.');
	if (!Number.isInteger(manifest?.inference?.maxConcurrentSequences) || manifest.inference.maxConcurrentSequences < 1) diagnostic(diagnostics, 'ai_appliance_concurrency_invalid', 'inference.maxConcurrentSequences', 'maxConcurrentSequences must be a positive integer.');
	if (!Number.isFinite(manifest?.inference?.gpuMemoryUtilization) || manifest.inference.gpuMemoryUtilization <= 0 || manifest.inference.gpuMemoryUtilization >= 1) diagnostic(diagnostics, 'ai_appliance_gpu_utilization_invalid', 'inference.gpuMemoryUtilization', 'gpuMemoryUtilization must be greater than zero and less than one.');
	if (manifest?.inference?.apiKeyRef && !secretReference(manifest.inference.apiKeyRef)) diagnostic(diagnostics, 'ai_appliance_api_key_ref_invalid', 'inference.apiKeyRef', 'apiKeyRef must be a secret reference.');
	for (const [name, provider] of Object.entries(manifest?.providers ?? {})) if (provider.enabled && !text(provider.manifest)) diagnostic(diagnostics, 'ai_appliance_provider_manifest_required', `providers.${name}.manifest`, 'Enabled providers require a manifest path.');
	if (manifest?.mode === 'standalone' && manifest?.standalone?.localControlPlane?.enabled !== true) diagnostic(diagnostics, 'ai_appliance_local_control_plane_required', 'standalone.localControlPlane.enabled', 'Standalone mode requires the local control plane.');
	return { ok: diagnostics.length === 0, diagnostics };
}

export function validateExecutionProviderRuntimeConfiguration(value: ExecutionProviderRuntimeConfiguration, path = 'executionProvider'): AiApplianceValidationResult {
	const diagnostics: AiApplianceDiagnostic[] = [];
	if (value.protocol && !['responses', 'chat-completions'].includes(value.protocol)) diagnostic(diagnostics, 'execution_provider_protocol_invalid', `${path}.protocol`, 'protocol must be responses or chat-completions.');
	if (value.module && !/^(?:builtin:[a-z0-9-]+|module:[a-z0-9-]+)$/u.test(value.module)) diagnostic(diagnostics, 'execution_provider_module_invalid', `${path}.module`, 'module must use a builtin: or module: identifier.');
	if (value.model?.baseUrl && !httpUrl(value.model.baseUrl)) diagnostic(diagnostics, 'execution_provider_base_url_invalid', `${path}.model.baseUrl`, 'model.baseUrl must be an HTTP URL.');
	if (value.credentialBindings && (new Set(value.credentialBindings).size !== value.credentialBindings.length || value.credentialBindings.some((entry) => !text(entry)))) diagnostic(diagnostics, 'execution_provider_credentials_invalid', `${path}.credentialBindings`, 'credentialBindings must contain unique non-empty IDs.');
	if (value.configurationDigest && !/^sha256:[a-f0-9]{64}$/u.test(value.configurationDigest)) diagnostic(diagnostics, 'execution_provider_configuration_digest_invalid', `${path}.configurationDigest`, 'configurationDigest must be a SHA-256 digest.');
	return { ok: diagnostics.length === 0, diagnostics };
}

export function validateExecutionProviderModuleManifest(manifest: ExecutionProviderModuleManifest): AiApplianceValidationResult {
	const diagnostics: AiApplianceDiagnostic[] = [];
	if (manifest?.schemaVersion !== EXECUTION_PROVIDER_MODULE_SCHEMA_VERSION || manifest?.apiVersion !== EXECUTION_PROVIDER_MODULE_SCHEMA_VERSION) diagnostic(diagnostics, 'execution_provider_module_schema_invalid', 'schemaVersion', `Module schema and API version must be ${EXECUTION_PROVIDER_MODULE_SCHEMA_VERSION}.`);
	for (const [path, value] of Object.entries({ id: manifest?.id, package: manifest?.package, version: manifest?.version, entrypoint: manifest?.entrypoint })) if (!text(value)) diagnostic(diagnostics, 'execution_provider_module_field_required', path, `${path} is required.`);
	if (manifest?.entrypoint?.startsWith('/') || manifest?.entrypoint?.split('/').includes('..')) diagnostic(diagnostics, 'execution_provider_module_entrypoint_unsafe', 'entrypoint', 'Module entrypoint must remain inside the installed artifact.');
	if (!Array.isArray(manifest?.adapters) || !manifest.adapters.length || manifest.adapters.some((entry) => !text(entry))) diagnostic(diagnostics, 'execution_provider_module_adapters_invalid', 'adapters', 'At least one adapter is required.');
	if (!Array.isArray(manifest?.permissions?.network) || !Array.isArray(manifest?.permissions?.credentials)) diagnostic(diagnostics, 'execution_provider_module_permissions_invalid', 'permissions', 'Network and credential permission arrays are required.');
	if (!/^sha256:[a-f0-9]{64}$/u.test(manifest?.digest ?? '')) diagnostic(diagnostics, 'execution_provider_module_digest_invalid', 'digest', 'Module digest must be an exact SHA-256 digest.');
	return { ok: diagnostics.length === 0, diagnostics };
}
