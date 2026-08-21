export const AI_APPLIANCE_SCHEMA_VERSION = 'treeseed.ai-appliance/v1' as const;
export const EXECUTION_PROVIDER_MODULE_SCHEMA_VERSION = 'treeseed.execution-provider/v1' as const;
export const DEFAULT_AI_CONTROL_PLANE_URL = 'https://api.treeseed.dev' as const;
export const DEFAULT_AI_MANAGEMENT_URL = 'http://127.0.0.1:4770' as const;
export const DEFAULT_AI_GATEWAY_URL = 'http://127.0.0.1:4771' as const;
export const DEFAULT_AI_MODEL_ALIAS = 'treeseed-qwen3.5-4b' as const;
export const DEFAULT_AI_MODEL_ID = 'Qwen/Qwen3.5-4B' as const;

export type AiApplianceMode = 'joined' | 'standalone';
export type InferenceProtocol = 'responses' | 'chat-completions';
export type ExecutionProviderProfile = 'subscription' | 'key' | 'treeseed' | string;

export interface AiApplianceManifest {
	schemaVersion: typeof AI_APPLIANCE_SCHEMA_VERSION;
	mode: AiApplianceMode;
	management: {
		socket: string;
		loopbackUrl?: string;
	};
	controlPlane: {
		enabled: boolean;
		url: string;
		audience: string;
	};
	inference: {
		publicAlias: string;
		model: string;
		gatewayUrl: string;
		rawVllmUrl: string;
		maxModelLength: number;
		maxConcurrentSequences: number;
		gpuMemoryUtilization: number;
		apiKeyRef?: string;
	};
	providers: {
		agent: AiApplianceProviderSelection;
		platformOperation: AiApplianceProviderSelection;
	};
	standalone?: {
		localControlPlane: {
			enabled: boolean;
			apiUrl: string;
			webUrl: string;
		};
	};
}

export interface AiApplianceProviderSelection {
	enabled: boolean;
	manifest: string;
}

export interface ExecutionProviderRuntimeConfiguration {
	profile?: ExecutionProviderProfile;
	module?: string;
	protocol?: InferenceProtocol;
	model?: {
		endpointRef?: string;
		baseUrl?: string;
		model?: string;
	};
	credentialBindings?: string[];
	healthProbe?: string;
	versionConstraint?: string;
	configurationDigest?: string;
}

export interface ExecutionProviderModuleManifest {
	schemaVersion: typeof EXECUTION_PROVIDER_MODULE_SCHEMA_VERSION;
	id: string;
	package: string;
	version: string;
	apiVersion: typeof EXECUTION_PROVIDER_MODULE_SCHEMA_VERSION;
	entrypoint: string;
	adapters: string[];
	permissions: {
		network: string[];
		credentials: string[];
	};
	digest: `sha256:${string}`;
	signature?: {
		keyId: string;
		value: string;
	};
}

export interface AiApplianceDiagnostic {
	code: string;
	path: string;
	severity: 'warning' | 'error';
	message: string;
}

export interface AiApplianceValidationResult {
	ok: boolean;
	diagnostics: AiApplianceDiagnostic[];
}
