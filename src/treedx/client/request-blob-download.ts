import { TreeDxApiError } from ".././errors.ts";
import type { SdkGraphSearchResult, TreeDxAuditEvent, TreeDxAuthMode, TreeDxBlob, TreeDxBlobUploadAbortRequest, TreeDxBlobUploadCompleteRequest, TreeDxBlobUploadCreateRequest, TreeDxBlobUploadPart, TreeDxBlobUploadPartRequest, TreeDxBlobUploadSession, TreeDxBlobDeleteRequest, TreeDxBlobDownload, TreeDxBlobDownloadRequest, TreeDxBlobMutationResult, TreeDxBlobReadRequest, TreeDxBlobUploadRequest, TreeDxBlobWriteRequest, TreeDxCapabilityGrant, TreeDxCommitRequest, TreeDxCommitResult, TreeDxContextRequest, TreeDxContextResult, TreeDxCtxParseRequest, TreeDxCtxParseResult, TreeDxDiff, TreeDxEffectiveScope, TreeDxEffectiveScopeRequest, TreeDxExecRequest, TreeDxExecResult, TreeDxFetchRemoteRequest, TreeDxFetchRemoteResult, TreeDxFederatedContextRequest, TreeDxFederatedContextResult, TreeDxFederatedGraphRequest, TreeDxFederatedGraphResult, TreeDxFederatedQueryRequest, TreeDxFederatedQueryResult, TreeDxFederatedSearchRequest, TreeDxFederatedSearchResult, TreeDxArtifact, TreeDxArtifactCleanupRequest, TreeDxArtifactCleanupResult, TreeDxArtifactDeleteRequest, TreeDxArtifactDownload, TreeDxArtifactExportRequest, TreeDxArtifactGetRequest, TreeDxArtifactListRequest, TreeDxFederationQueryPlan, TreeDxFederationQueryPlanRequest, TreeDxFile, TreeDxFileMutationResult, TreeDxGraphNodeRequest, TreeDxGraphQueryRequest, TreeDxGraphQueryResult, TreeDxGraphRefreshJob, TreeDxGraphRefreshJobRequest, TreeDxGraphRefreshRequest, TreeDxGraphRefreshResult, TreeDxGraphRelatedRequest, TreeDxGraphSearchRequest, TreeDxGraphSubgraphRequest, TreeDxHealth, TreeDxListTreeRequest, TreeDxMigration, TreeDxMigrationRequest, TreeDxMirrorHealthRequest, TreeDxMirrorHealthResult, TreeDxMirrorPromotionRequest, TreeDxMirrorPromotionResult, TreeDxMirrorSyncRequest, TreeDxMirrorSyncResult, TreeDxNode, TreeDxPatchFileRequest, TreeDxReadFileRequest, TreeDxRepository, TreeDxRepositoryPathsRequest, TreeDxRepositoryPlacement, TreeDxRepositoryQueryRequest, TreeDxRepositoryQueryResult, TreeDxRepositoryReadRequest, TreeDxRepositorySearchRequest, TreeDxSearchRequest, TreeDxSearchIndexCompactRequest, TreeDxSearchIndexCompactResult, TreeDxSearchIndexRefreshRequest, TreeDxSearchIndexRefreshResult, TreeDxSearchIndexStatus, TreeDxSearchIndexStatusRequest, TreeDxSearchResult, TreeDxSnapshot, TreeDxSnapshotBuildRequest, TreeDxStorageBackupRequest, TreeDxStorageBackupResult, TreeDxStorageCompactRequest, TreeDxStorageCompactResult, TreeDxStorageMigration, TreeDxStorageMigrationPlanRequest, TreeDxStorageMigrationRollbackRequest, TreeDxStorageRestoreRequest, TreeDxStorageRestoreResult, TreeDxStorageRestoreVerifyRequest, TreeDxStatus, TreeDxTreeEntry, TreeDxClientOptions, TreeDxPushRequest, TreeDxPushResult, TreeDxWhoami, TreeDxWorkspace, TreeDxCreateWorkspaceRequest, TreeDxDeleteFileRequest, TreeDxDeepHealth, TreeDxWorkspaceRequest, TreeDxWriteFileRequest, TreeDxMetrics, TreeDxReadiness, TreeDxRegisterRepositoryRequest, } from ".././types.ts";
import { HttpMethod, normalizeBaseUrl, isRecord, isAbortError, stripOk, firstPayload, TREEDX_CLIENT_OPERATION_MAP, TreeDxClient, parseFilename } from "../client.ts";
export async function requestBlobDownloadMethod(this: TreeDxClient, input: TreeDxBlobDownloadRequest): Promise<TreeDxBlobDownload> {
    if (!this.token) {
        throw new TreeDxApiError('TreeDX bearer token is required.', {
            status: 401,
            code: 'missing_token',
        });
    }
    const response = await this.fetchWithTimeout(`${this.baseUrl}/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/blobs/download${this.query({
        path: input.path,
        allowProtected: input.allowProtected,
    })}`, {
        method: 'GET',
        headers: this.headers(false),
    });
    await this.assertBinaryOk(response);
    return {
        content: await response.arrayBuffer(),
        contentType: response.headers.get('content-type'),
        contentHash: response.headers.get('x-treedx-content-hash') ?? undefined,
        objectId: response.headers.get('x-treedx-object-id') ?? undefined,
        source: response.headers.get('x-treedx-source') as TreeDxBlobDownload['source'] | undefined,
    };
}
