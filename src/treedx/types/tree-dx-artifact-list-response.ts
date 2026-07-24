import type {
	SdkContextPack,
	SdkContextPackRequest,
	SdkGraphDslParseResult,
	SdkGraphEdge,
	SdkGraphNode,
	SdkGraphQueryRequest,
	SdkGraphQueryResult,
	SdkGraphRefreshPayload,
	SdkGraphRefreshRequest,
	SdkGraphSearchOptions,
	SdkGraphSearchResult,
	SdkGraphTraversalResult,
} from '../../entrypoints/models/sdk-types.ts';
import type { components, operations, paths } from '../generated/openapi-types.ts';


export type TreeDxArtifactListResponse = components['schemas']['TreeDxListArtifactsResponse'];

export type TreeDxMirrorListResponse = components['schemas']['TreeDxListMirrorsResponse'];

export type TreeDxMirrorResponse = components['schemas']['TreeDxPutMirrorResponse'];

export type TreeDxMigrationResponse = components['schemas']['TreeDxGetMigrationResponse'];

export type TreeDxFederationQueryPlanResponse = components['schemas']['TreeDxPlanFederationQueryResponse'];

export type TreeDxFederatedSearchResponse = components['schemas']['TreeDxFederatedSearchResponse'];

export type TreeDxFederatedQueryResponse = components['schemas']['TreeDxFederatedQueryResponse'];

export type TreeDxFederatedContextResponse = components['schemas']['TreeDxFederatedContextBuildResponse'];

export type TreeDxFederatedGraphResponse = components['schemas']['TreeDxFederatedGraphQueryResponse'];

export type TreeDxStorageHealthResponse = components['schemas']['TreeDxGetAdminStorageHealthResponse'];

export type TreeDxStorageCheckResponse = components['schemas']['TreeDxCheckAdminStorageResponse'];

export type TreeDxStorageMigrationListResponse = components['schemas']['TreeDxListStorageMigrationsResponse'];
