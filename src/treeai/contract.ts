import { CONTROL_PLANE_CATALOG } from '../operator-contracts/control-plane-operations.ts';
import { standardsSha256 } from '../standards/canonicalize.ts';
import { TREEAI_CONTROL_PLANE_OPERATION_LIST, TREEAI_OPENAPI_DIGESTS } from './catalog.ts';
import { TREEAI_UPSTREAM_OPERATIONS } from './generated/upstream.ts';

export const TREESEED_TREEAI_SERVICE_CONTRACT_SCHEMA = 'treeseed.treeai-service-contract/v1' as const;
export const TREEAI_ADOPTION = {
	release: '0.11.0-rc2', sourceCommit: '9770c99ba3a2f91ce916b48efafa45b0e971bbf0',
	packageArtifactDigest: 'sha256:90d695d499088f2788da36863128efe57079915d3999cc876888ceb091cb95f2',
	operationInventoryDigest: 'sha256:dc60eb514e11a4b867b3353830d886205df6254c7c4ecfab9a06b1b4dcb4e1fc',
} as const;

export function validateTreeAiOperationMapping() {
	const authoritative = new Set(TREEAI_UPSTREAM_OPERATIONS.map(({ operationId }) => operationId));
	const mapped = TREEAI_CONTROL_PLANE_OPERATION_LIST.map(({ descriptor }) => descriptor.upstream?.operationId).filter(Boolean) as string[];
	return [
		...mapped.filter((id) => !authoritative.has(id)).map((id) => `unknown_upstream_operation:${id}`),
		...TREEAI_UPSTREAM_OPERATIONS.filter(({ operationId }) => !mapped.includes(operationId)).map(({ operationId }) => `unmapped_upstream_operation:${operationId}`),
	].sort();
}

export async function createTreeAiServiceContractReceipt() {
	const mapping = TREEAI_CONTROL_PLANE_OPERATION_LIST.map(({ descriptor }) => ({
		treeseedOperationId: descriptor.operationId, treeaiOperationId: descriptor.upstream!.operationId,
		contractVersion: descriptor.upstream!.contractVersion, contractDigest: descriptor.upstream!.contractDigest,
		capability: descriptor.capability, authentication: descriptor.authentication, oauthScopes: descriptor.oauthScopes,
		riskClass: descriptor.riskClass, idempotency: descriptor.idempotency, concurrency: descriptor.concurrency,
		surfaces: descriptor.surfaces, redactedPaths: descriptor.redactedPaths,
	})).sort((left, right) => left.treeseedOperationId.localeCompare(right.treeseedOperationId));
	return {
		schema: TREESEED_TREEAI_SERVICE_CONTRACT_SCHEMA, ...TREEAI_ADOPTION, openapiVersion: '3.1.1', openapiDigests: TREEAI_OPENAPI_DIGESTS,
		controlPlaneCatalogDigest: await standardsSha256(CONTROL_PLANE_CATALOG), operationMapping: mapping,
		operationMappingDigest: await standardsSha256(mapping), compatibility: { direct: true, controlPlane: true },
	} as const;
}
