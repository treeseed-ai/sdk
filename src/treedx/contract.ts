import { TREEDX_OPENAPI_CONTRACT, TREEDX_OPENAPI_OPERATIONS } from '@treeseed/treedx';
import { CONTROL_PLANE_CATALOG } from '../operator-contracts/control-plane-operations.ts';
import { standardsSha256 } from '../standards/canonicalize.ts';

export const TREESEED_TREEDX_SERVICE_CONTRACT_SCHEMA = 'treeseed.treedx-service-contract/v1' as const;

export interface TreeDxAdoptionEvidence {
	treedxSourceCommit: string;
	treedxPackageArtifactDigest: `sha256:${string}`;
}

export const TREESEED_PRIVATE_TREEDX_OPERATION_IDS = new Set([
	'createDevToken',
	'putCapabilityGrant',
	'listCapabilityGrants',
	'listAuditEvents',
	'proxyInternalFederationRequest',
	'exportInternalFederationMirror',
	'importInternalFederationMirror',
	'putRepositoryPlacement',
	'createMigration',
	'getMigration',
	'putMirror',
	'syncMirror',
	'promoteMirror',
	'execWorkspace',
]);

export function treeDxProxyOperationMapping() {
	return CONTROL_PLANE_CATALOG.operations
		.filter((operation) => operation.upstream?.service === 'treedx')
		.map((operation) => ({
			treeseedOperationId: operation.operationId,
			treedxOperationId: operation.upstream!.operationId,
			contractVersion: operation.upstream!.contractVersion,
			contractDigest: operation.upstream!.contractDigest,
		}))
		.sort((left, right) => left.treeseedOperationId.localeCompare(right.treeseedOperationId));
}

export function validateTreeDxProxyOperationMapping() {
	const authoritativeIds = new Set<string>(TREEDX_OPENAPI_OPERATIONS.map((operation) => operation.operationId));
	const diagnostics: string[] = [];
	for (const mapping of treeDxProxyOperationMapping()) {
		if (!authoritativeIds.has(mapping.treedxOperationId)) diagnostics.push(`unknown_upstream_operation:${mapping.treedxOperationId}`);
		if (TREESEED_PRIVATE_TREEDX_OPERATION_IDS.has(mapping.treedxOperationId)) diagnostics.push(`private_upstream_operation:${mapping.treedxOperationId}`);
		if (mapping.contractVersion !== TREEDX_OPENAPI_CONTRACT.openapiVersion) diagnostics.push(`contract_version_drift:${mapping.treeseedOperationId}`);
		if (mapping.contractDigest !== TREEDX_OPENAPI_CONTRACT.openapiSha256) diagnostics.push(`contract_digest_drift:${mapping.treeseedOperationId}`);
	}
	return diagnostics.sort();
}

export async function createTreeDxServiceContractReceipt(
	controlPlaneCatalogDigest: `sha256:${string}`,
	evidence: TreeDxAdoptionEvidence,
) {
	const operationMapping = treeDxProxyOperationMapping();
	return {
		schema: TREESEED_TREEDX_SERVICE_CONTRACT_SCHEMA,
		treedxPackageVersion: TREEDX_OPENAPI_CONTRACT.packageVersion,
		treedxOpenapiVersion: TREEDX_OPENAPI_CONTRACT.openapiVersion,
		treedxOpenapiDigest: TREEDX_OPENAPI_CONTRACT.openapiSha256,
		treedxOperationInventoryDigest: TREEDX_OPENAPI_CONTRACT.operationInventorySha256,
		treedxGeneratedTypesDigest: TREEDX_OPENAPI_CONTRACT.generatedTypesSha256,
		treedxSourceCommit: evidence.treedxSourceCommit,
		treedxPackageArtifactDigest: evidence.treedxPackageArtifactDigest,
		controlPlaneCatalogDigest,
		operationMapping,
		operationMappingDigest: await standardsSha256(operationMapping),
		compatibility: TREEDX_OPENAPI_CONTRACT.compatibility,
	} as const;
}
