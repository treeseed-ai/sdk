import { canonicalizeStandardsValue } from '../canonicalize.ts';
import type { TreeSeedMcpCatalog } from '../../operator-contracts/mcp.ts';
import type { ControlPlaneOperationDescriptor } from '../../operator-contracts/control-plane-operation.ts';
import type { McpContractModel } from './contracts.ts';

export function normalizeMcpCatalog(
	catalog: TreeSeedMcpCatalog,
	operations: readonly ControlPlaneOperationDescriptor[],
	schemas: Readonly<Record<string, unknown>>,
): McpContractModel {
	const operationById = new Map(operations.map((operation) => [operation.operationId, operation]));
	return {
		schemaVersion: 1,
		protocolVersion: catalog.protocolVersion,
		tools: Object.fromEntries([...catalog.tools].sort((left, right) => left.name.localeCompare(right.name)).map((tool) => {
			const operation = operationById.get(tool.operationId);
			if (!operation) throw new Error(`MCP tool ${tool.name} references unknown operation ${tool.operationId}.`);
			return [tool.name, {
				inputSchema: canonicalizeStandardsValue(schemas[tool.inputSchemaId] ?? {}),
				outputSchema: canonicalizeStandardsValue(schemas[tool.outputSchemaId] ?? {}),
				requiredScopes: [...operation.oauthScopes].sort(),
				riskClass: operation.riskClass,
			}];
		})),
		resources: Object.fromEntries([...catalog.resources].sort((left, right) => left.uriTemplate.localeCompare(right.uriTemplate)).map((resource) => [resource.uriTemplate, {
			uriTemplate: resource.uriTemplate,
			operationId: resource.operationId,
			subscribable: resource.subscribable,
		}])),
		prompts: Object.fromEntries([...catalog.prompts].sort((left, right) => left.name.localeCompare(right.name)).map((prompt) => [prompt.name, {
			argumentSchema: canonicalizeStandardsValue(schemas[prompt.argumentSchemaId] ?? {}),
			requiredScopes: [...prompt.requiredScopes].sort(),
		}])),
	};
}
