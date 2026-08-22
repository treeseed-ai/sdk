import type { ControlPlaneOperationDescriptor, OAuthScope } from './control-plane-operation.ts';

export const MCP_PROTOCOL_VERSION = '2026-07-28' as const;

export interface ResourceLink {
	type: 'resource_link';
	uri: `treeseed://${string}`;
	name: string;
	title?: string;
	description?: string;
	mimeType?: string;
}

export interface ActorChain {
	principalId: string;
	delegatedAgentId?: string;
	oauthClientId: string;
	interface: 'rest' | 'cli' | 'mcp' | 'site_bff' | 'internal';
	conversationId?: string;
	modelClaim?: string;
	skillClaim?: string;
	traceId: string;
}

export interface ConfirmationState {
	schemaVersion: 'treeseed.confirmation-state/v1';
	principalId: string;
	clientId: string;
	operationId: string;
	argumentsDigest: `sha256:${string}`;
	expiresAt: string;
	nonce: string;
	signature: string;
}

export interface InputRequired {
	type: 'input_required';
	requestId: string;
	prompt: string;
	confirmation: ConfirmationState;
}

export interface McpToolDescriptor {
	name: string;
	description: string;
	inputSchemaId: string;
	outputSchemaId: string;
	operationId: string;
	readOnlyHint: boolean;
	destructiveHint: boolean;
	idempotentHint: boolean;
	openWorldHint: boolean;
}

export interface McpResourceDescriptor {
	uriTemplate: `treeseed://${string}`;
	name: string;
	description: string;
	mimeType: string;
	operationId: string;
	subscribable: boolean;
	cacheTtlSeconds?: number;
}

export interface McpPromptDescriptor {
	name: string;
	description: string;
	argumentSchemaId: string;
	requiredScopes: OAuthScope[];
}

export interface McpCatalog {
	schemaVersion: 'treeseed.mcp-catalog/v1';
	protocolVersion: typeof MCP_PROTOCOL_VERSION;
	tools: McpToolDescriptor[];
	resources: McpResourceDescriptor[];
	prompts: McpPromptDescriptor[];
	capabilities: {
		completion: true;
		progress: true;
		cancellation: true;
		inputRequired: true;
		resourceSubscriptions: true;
	};
}

export const TREESEED_MCP_PROMPTS: readonly McpPromptDescriptor[] = [
	{ name: 'operate', description: 'Operate TreeSeed through currently discoverable capabilities.', argumentSchemaId: 'treeseed.prompt.objective/v1', requiredScopes: ['treeseed:read'] },
	{ name: 'research', description: 'Research a governed TreeSeed question and accumulate knowledge.', argumentSchemaId: 'treeseed.prompt.objective/v1', requiredScopes: ['treeseed:read'] },
	{ name: 'governance-review', description: 'Review a proposal or decision using current governance evidence.', argumentSchemaId: 'treeseed.prompt.objective/v1', requiredScopes: ['treeseed:read'] },
	{ name: 'workday-planning', description: 'Plan a time-based workday without bypassing API authority.', argumentSchemaId: 'treeseed.prompt.objective/v1', requiredScopes: ['treeseed:read'] },
	{ name: 'project-agent-chat', description: 'Prepare an explicit governed project-agent chat invocation.', argumentSchemaId: 'treeseed.prompt.objective/v1', requiredScopes: ['treeseed:read'] },
];

function resourcePath(restPath: string) {
	if (!restPath.startsWith('/v1/')) throw new Error(`MCP resource REST path must be rooted at /v1: ${restPath}`);
	const path = restPath.replace(/^\/v1\//u, '');
	if (path === 'me') return 'accounts/current';
	return path
		.replace(/^platform\/operations(?=\/|$)/u, 'operations')
		.replace(/^capacity-plans(?=\/|$)/u, 'plans')
		.replace(/\/workday-runs(?=\/|$)/u, '/workdays')
		.replace(/\/capacity\/assignments(?=\/|$)/u, '/assignments');
}

export function operationToMcpResource(operation: ControlPlaneOperationDescriptor): McpResourceDescriptor | null {
	if (!operation.surfaces.includes('mcp_resource')) return null;
	if (operation.kind !== 'read' || operation.rest.method !== 'GET') {
		throw new Error(`MCP resource operation ${operation.operationId} must be a read-only GET operation.`);
	}
	const uriTemplate = `treeseed://${resourcePath(operation.rest.path)}` as const;
	const parameters = (value: string) => [...value.matchAll(/\{([^}]+)\}/gu)].map((match) => match[1]).sort();
	if (JSON.stringify(parameters(uriTemplate)) !== JSON.stringify(parameters(operation.rest.path))) {
		throw new Error(`MCP resource ${operation.operationId} must preserve its REST path parameter names.`);
	}
	return {
		uriTemplate,
		name: operation.operationId,
		description: operation.description,
		mimeType: 'application/json',
		operationId: operation.operationId,
		subscribable: true,
		...(operation.operationId === 'status.show' ? { cacheTtlSeconds: 10 } : {}),
	};
}

export function operationToMcpTool(operation: ControlPlaneOperationDescriptor): McpToolDescriptor | null {
	if (!operation.surfaces.includes('mcp_tool')) return null;
	return {
		name: operation.operationId,
		description: operation.description,
		inputSchemaId: operation.schemas.input,
		outputSchemaId: operation.schemas.output,
		operationId: operation.operationId,
		readOnlyHint: operation.kind === 'read',
		destructiveHint: operation.riskClass !== 'ordinary',
		idempotentHint: operation.kind === 'read' || operation.idempotency.required,
		openWorldHint: false,
	};
}

export function buildMcpTools(operations: readonly ControlPlaneOperationDescriptor[]) {
	return operations.map(operationToMcpTool).filter((tool): tool is McpToolDescriptor => tool !== null)
		.sort((left, right) => left.name.localeCompare(right.name));
}

export function buildMcpResources(operations: readonly ControlPlaneOperationDescriptor[]) {
	const resources = operations.map(operationToMcpResource).filter((resource): resource is McpResourceDescriptor => resource !== null)
		.sort((left, right) => left.uriTemplate.localeCompare(right.uriTemplate));
	const uriTemplates = new Set(resources.map(({ uriTemplate }) => uriTemplate));
	if (uriTemplates.size !== resources.length) throw new Error('MCP resource URI templates must be unique.');
	return resources;
}

export function buildMcpCatalog(operations: readonly ControlPlaneOperationDescriptor[]): McpCatalog {
	return {
		schemaVersion: 'treeseed.mcp-catalog/v1',
		protocolVersion: MCP_PROTOCOL_VERSION,
		tools: buildMcpTools(operations),
		resources: buildMcpResources(operations),
		prompts: [...TREESEED_MCP_PROMPTS],
		capabilities: { completion: true, progress: true, cancellation: true, inputRequired: true, resourceSubscriptions: true },
	};
}
