import type { ControlPlaneOperationDescriptor, TreeSeedOAuthScope } from './control-plane-operation.ts';

export const MCP_PROTOCOL_VERSION = '2026-07-28' as const;

export interface TreeSeedResourceLink {
	type: 'resource_link';
	uri: `treeseed://${string}`;
	name: string;
	title?: string;
	description?: string;
	mimeType?: string;
}

export interface TreeSeedActorChain {
	principalId: string;
	delegatedAgentId?: string;
	oauthClientId: string;
	interface: 'rest' | 'cli' | 'mcp' | 'site_bff' | 'internal';
	conversationId?: string;
	modelClaim?: string;
	skillClaim?: string;
	traceId: string;
}

export interface TreeSeedConfirmationState {
	schemaVersion: 'treeseed.confirmation-state/v1';
	principalId: string;
	clientId: string;
	operationId: string;
	argumentsDigest: `sha256:${string}`;
	expiresAt: string;
	nonce: string;
	signature: string;
}

export interface TreeSeedInputRequired {
	type: 'input_required';
	requestId: string;
	prompt: string;
	confirmation: TreeSeedConfirmationState;
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
	requiredScopes: TreeSeedOAuthScope[];
}

export interface TreeSeedMcpCatalog {
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
