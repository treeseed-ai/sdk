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
} from '../../sdk-types.ts';
import type { components, operations, paths } from '../generated/openapi-types.ts';
import { TreeDxFetchRemoteRequest } from './tree-dx-context-request.ts';
import { TreeDxRepositoryPlacement } from './tree-dx-actor.ts';

export interface TreeDxPushRequest extends TreeDxFetchRemoteRequest {
	refspecs: string[];
	expectedRemoteHead?: string | null;
}

export interface TreeDxPushResult {
	repoId?: string;
	remoteName: string;
	remoteUrl?: string | null;
	refspecs: string[];
	planOnly?: boolean;
	backend: string;
	status: 'plan' | 'pushed' | string;
	updatedRefs: string[];
	rejectedRefs: string[];
	beforeHead?: string | null;
	afterHead?: string | null;
}

export interface TreeDxMirrorHealthRequest {
	repoId?: string;
	mirrorId: string;
}

export interface TreeDxMirrorHealthResult {
	health: {
		mirrorId: string;
		repoId: string;
		status: 'healthy' | 'degraded' | 'unhealthy' | string;
		mirrorStatus?: string;
		behindBy?: number | null;
		lastSeenCommit?: string | null;
	};
}

export interface TreeDxMirrorPromotionRequest {
	repoId?: string;
	mirrorId: string;
	planOnly?: boolean;
	requireSynced?: boolean;
}

export interface TreeDxMirrorPromotionResult {
	promotion: {
		mirrorId: string;
		repoId: string;
		planOnly: boolean;
		status: 'planned' | 'promoted' | string;
		previousPlacement?: TreeDxRepositoryPlacement | null;
		resultingPlacement?: TreeDxRepositoryPlacement | null;
	};
}

export interface TreeDxStorageCompactRequest {
	logs?: string[];
	planOnly?: boolean;
	backupBefore?: boolean;
}

export interface TreeDxStorageCompactResult {
	compact: {
		status: string;
		planOnly: boolean;
		backupId?: string | null;
		files: Array<{
			file: string;
			recordsBefore: number;
			recordsAfter: number;
			bytesBefore: number;
			bytesAfter: number;
			compacted: boolean;
		}>;
	};
}

export interface TreeDxStorageBackupRequest {
	include?: string[];
	verify?: boolean;
}

export interface TreeDxStorageBackupResult {
	backup: {
		backupId: string;
		format: 'tar.zst';
		uri: string;
		checksum: string;
		byteLength: number;
		verified: boolean;
	};
}

export interface TreeDxStorageMigration {
	migrationId: string;
	fromVersion?: string;
	toVersion?: string;
	planOnly?: boolean;
	reversible?: boolean;
	logs?: string[];
	status: string;
	backupId?: string | null;
	startedAt?: string;
	completedAt?: string;
}

export interface TreeDxStorageMigrationPlanRequest {
	targetVersion?: string;
	backupBefore?: boolean;
}

export interface TreeDxStorageMigrationRollbackRequest {
	migrationId: string;
}

export interface TreeDxStorageRestoreVerifyRequest {
	backupId: string;
}

export interface TreeDxStorageRestoreRequest extends TreeDxStorageRestoreVerifyRequest {
	planOnly?: boolean;
	backupBeforeRestore?: boolean;
	force?: boolean;
}

export interface TreeDxStorageRestoreResult {
	restore: {
		restoreId?: string;
		backupId: string;
		planOnly: boolean;
		verified?: boolean;
		backupBeforeRestore?: boolean;
		preRestoreBackupId?: string | null;
		status?: string;
		uri: string;
	};
}

export interface TreeDxMigrationRequest {
	repoId?: string;
	targetNodeId: string;
	sourceNodeId?: string;
	mode?: 'primary_transfer' | 'mirror_promotion';
	planOnly?: boolean;
	requireMirrorSynced?: boolean;
}

export interface TreeDxMigration {
	id: string;
	repositoryId: string;
	sourceNodeId: string;
	targetNodeId: string;
	mode: string;
	status: string;
	planOnly: boolean;
	requireMirrorSynced: boolean;
	previousPlacement?: TreeDxRepositoryPlacement | null;
	resultingPlacement?: TreeDxRepositoryPlacement | null;
	createdAt: string;
	completedAt?: string | null;
}

export type {
	components as TreeDxOpenApiComponents,
	operations as TreeDxOpenApiOperations,
	paths as TreeDxOpenApiPaths,
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
};

export type TreeDxWhoamiResponse = components['schemas']['TreeDxGetWhoamiResponse'];

export type TreeDxReadinessResponse = components['schemas']['TreeDxReadinessResponse'];

export type TreeDxDeepHealthResponse = components['schemas']['TreeDxDeepHealthResponse'];

export type TreeDxMetricsResponse = components['schemas']['TreeDxMetricsResponse'];

export type TreeDxAuthModeResponse = components['schemas']['TreeDxGetAuthModeResponse'];

export type TreeDxDevTokenResponse = components['schemas']['TreeDxCreateDevTokenResponse'];

export type TreeDxEffectiveScopeResponse = components['schemas']['TreeDxGetEffectiveScopeResponse'];

export type TreeDxPolicyRefreshResponse = components['schemas']['TreeDxRefreshPolicyResponse'];

export type TreeDxCapabilityGrantResponse = components['schemas']['TreeDxPutCapabilityGrantResponse'];

export type TreeDxCapabilityGrantListResponse = components['schemas']['TreeDxListCapabilityGrantsResponse'];

export type TreeDxAuditEventListResponse = components['schemas']['TreeDxListAuditEventsResponse'];

export type TreeDxNodeResponse = components['schemas']['TreeDxGetLocalNodeResponse'];

export type TreeDxNodeListResponse = components['schemas']['TreeDxListRegistryNodesResponse'];

export type TreeDxRepositoryPlacementResponse = components['schemas']['TreeDxGetRepositoryPlacementResponse'];

export type TreeDxRepositoryResponse = components['schemas']['TreeDxGetRepositoryResponse'];

export type TreeDxRepositoryListResponse = components['schemas']['TreeDxListRepositoriesResponse'];

export type TreeDxRepositoryStatusResponse = components['schemas']['TreeDxGetRepositoryStatusResponse'];

export type TreeDxRepositoryRefListResponse = components['schemas']['TreeDxListRepositoryRefsResponse'];

export type TreeDxRepositoryRemoteListResponse = components['schemas']['TreeDxListRepositoryRemotesResponse'];

export type TreeDxFetchRemoteResponse = components['schemas']['TreeDxSyncRepositoryResponse'];

export type TreeDxPushResponse = components['schemas']['TreeDxPushRepositoryResponse'];

export type TreeDxWorkspaceResponse = components['schemas']['TreeDxGetWorkspaceResponse'];

export type TreeDxWorkspaceClosedResponse = components['schemas']['TreeDxCloseWorkspaceResponse'];

export type TreeDxTreeResponse = components['schemas']['TreeDxListWorkspaceTreeResponse'];

export type TreeDxFileResponse = components['schemas']['TreeDxReadWorkspaceFileResponse'];

export type TreeDxFileMutationResponse = components['schemas']['TreeDxWriteWorkspaceFileResponse'];

export type TreeDxBlobResponse = components['schemas']['TreeDxReadRepositoryBlobResponse'];

export type TreeDxBlobMutationResponse = components['schemas']['TreeDxWriteWorkspaceBlobResponse'];

export type TreeDxBlobUploadSessionResponse = components['schemas']['TreeDxCreateWorkspaceBlobUploadResponse'];

export type TreeDxBlobUploadPartResponse = components['schemas']['TreeDxUploadWorkspaceBlobPartResponse'];

export type TreeDxRepositoryQueryResponse = components['schemas']['TreeDxQueryRepositoryResponse'];

export type TreeDxGraphRefreshResponse = components['schemas']['TreeDxRefreshRepositoryGraphResponse'];

export type TreeDxGraphRefreshJobResponse = components['schemas']['TreeDxGetGraphRefreshJobResponse'];

export type TreeDxGraphQueryResponse = components['schemas']['TreeDxQueryRepositoryGraphResponse'];

export type TreeDxGraphSearchResponse = components['schemas']['TreeDxSearchGraphFilesResponse'];

export type TreeDxGraphNodeResponse = components['schemas']['TreeDxGetGraphNodeResponse'];

export type TreeDxGraphTraversalResponse = components['schemas']['TreeDxGetRelatedGraphNodesResponse'];

export type TreeDxContextResponse = components['schemas']['TreeDxBuildContextResponse'];

export type TreeDxCtxParseResponse = components['schemas']['TreeDxParseContextQueryResponse'];

export type TreeDxSnapshotResponse = components['schemas']['TreeDxGetSnapshotResponse'];

export type TreeDxArtifactResponse = components['schemas']['TreeDxGetArtifactResponse'];
