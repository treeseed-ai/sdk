import { CONTROL_PLANE_CATALOG } from '../operator-contracts/control-plane-operations.ts';
import { standardsSha256 } from '../standards/canonicalize.ts';
import { TREEAI_CONTROL_PLANE_OPERATION_LIST, TREEAI_OPENAPI_DIGESTS } from './catalog.ts';
import { TREEAI_UPSTREAM_OPERATIONS } from './generated/upstream.ts';

export const TREESEED_TREEAI_SERVICE_CONTRACT_SCHEMA = 'treeseed.treeai-service-contract/v1' as const;
export const TREEAI_ADOPTION = {
	release: '0.11.0-rc22', sourceCommit: 'e3a462f30bfdc3539d3a5511932f28212f06a936',
	packageArtifactDigest: 'sha256:25591daab061a782cf2a605be2977a0e1acf6e17c031e2cd1fe3b22166359a8c',
	operationInventoryDigest: 'sha256:f1eaf33641e615e2f714d01d96e95454c42482d4ebbece6156e7601c5bb645d7',
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
