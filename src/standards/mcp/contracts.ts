import type { CompatibilityClassification } from '../contracts.ts';
import type { TreeSeedOAuthScope } from '../../operator-contracts/control-plane-operation.ts';

export interface McpNormalizedTool {
	inputSchema: unknown;
	outputSchema: unknown;
	requiredScopes: TreeSeedOAuthScope[];
	riskClass: string;
}

export interface McpNormalizedResource {
	uriTemplate: string;
	operationId: string;
	subscribable: boolean;
}

export interface McpNormalizedPrompt {
	argumentSchema: unknown;
	requiredScopes: TreeSeedOAuthScope[];
}

export interface McpContractModel {
	schemaVersion: 1;
	protocolVersion: string;
	tools: Record<string, McpNormalizedTool>;
	resources: Record<string, McpNormalizedResource>;
	prompts: Record<string, McpNormalizedPrompt>;
}

export interface McpCompatibilityFinding {
	code: string;
	path: string;
	message: string;
	classification: CompatibilityClassification;
}

export interface McpCompatibilityComparison {
	classification: CompatibilityClassification;
	findings: McpCompatibilityFinding[];
}
