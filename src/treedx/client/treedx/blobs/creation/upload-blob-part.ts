import { TreeDxApiError } from "../../../../support/errors.ts";
import type { SdkGraphSearchResult, TreeDxAuditEvent, TreeDxAuthMode, TreeDxBlob, TreeDxBlobUploadAbortRequest, TreeDxBlobUploadCompleteRequest, TreeDxBlobUploadCreateRequest, TreeDxBlobUploadPart, TreeDxBlobUploadPartRequest, TreeDxBlobUploadSession, TreeDxBlobDeleteRequest, TreeDxBlobDownload, TreeDxBlobDownloadRequest, TreeDxBlobMutationResult, TreeDxBlobReadRequest, TreeDxBlobUploadRequest, TreeDxBlobWriteRequest, TreeDxCapabilityGrant, TreeDxCommitRequest, TreeDxCommitResult, TreeDxContextRequest, TreeDxContextResult, TreeDxCtxParseRequest, TreeDxCtxParseResult, TreeDxDiff, TreeDxEffectiveScope, TreeDxEffectiveScopeRequest, TreeDxExecRequest, TreeDxExecResult, TreeDxFetchRemoteRequest, TreeDxFetchRemoteResult, TreeDxFederatedContextRequest, TreeDxFederatedContextResult, TreeDxFederatedGraphRequest, TreeDxFederatedGraphResult, TreeDxFederatedQueryRequest, TreeDxFederatedQueryResult, TreeDxFederatedSearchRequest, TreeDxFederatedSearchResult, TreeDxArtifact, TreeDxArtifactCleanupRequest, TreeDxArtifactCleanupResult, TreeDxArtifactDeleteRequest, TreeDxArtifactDownload, TreeDxArtifactExportRequest, TreeDxArtifactGetRequest, TreeDxArtifactListRequest, TreeDxFederationQueryPlan, TreeDxFederationQueryPlanRequest, TreeDxFile, TreeDxFileMutationResult, TreeDxGraphNodeRequest, TreeDxGraphQueryRequest, TreeDxGraphQueryResult, TreeDxGraphRefreshJob, TreeDxGraphRefreshJobRequest, TreeDxGraphRefreshRequest, TreeDxGraphRefreshResult, TreeDxGraphRelatedRequest, TreeDxGraphSearchRequest, TreeDxGraphSubgraphRequest, TreeDxHealth, TreeDxListTreeRequest, TreeDxMigration, TreeDxMigrationRequest, TreeDxMirrorHealthRequest, TreeDxMirrorHealthResult, TreeDxMirrorPromotionRequest, TreeDxMirrorPromotionResult, TreeDxMirrorSyncRequest, TreeDxMirrorSyncResult, TreeDxNode, TreeDxPatchFileRequest, TreeDxReadFileRequest, TreeDxRepository, TreeDxRepositoryPathsRequest, TreeDxRepositoryPlacement, TreeDxRepositoryQueryRequest, TreeDxRepositoryQueryResult, TreeDxRepositoryReadRequest, TreeDxRepositorySearchRequest, TreeDxSearchRequest, TreeDxSearchIndexCompactRequest, TreeDxSearchIndexCompactResult, TreeDxSearchIndexRefreshRequest, TreeDxSearchIndexRefreshResult, TreeDxSearchIndexStatus, TreeDxSearchIndexStatusRequest, TreeDxSearchResult, TreeDxSnapshot, TreeDxSnapshotBuildRequest, TreeDxStorageBackupRequest, TreeDxStorageBackupResult, TreeDxStorageCompactRequest, TreeDxStorageCompactResult, TreeDxStorageMigration, TreeDxStorageMigrationPlanRequest, TreeDxStorageMigrationRollbackRequest, TreeDxStorageRestoreRequest, TreeDxStorageRestoreResult, TreeDxStorageRestoreVerifyRequest, TreeDxStatus, TreeDxTreeEntry, TreeDxClientOptions, TreeDxPushRequest, TreeDxPushResult, TreeDxWhoami, TreeDxWorkspace, TreeDxCreateWorkspaceRequest, TreeDxDeleteFileRequest, TreeDxDeepHealth, TreeDxWorkspaceRequest, TreeDxWriteFileRequest, TreeDxMetrics, TreeDxReadiness, TreeDxRegisterRepositoryRequest, } from "../../../../types.ts";
import { HttpMethod, normalizeBaseUrl, isRecord, isAbortError, stripOk, firstPayload, TREEDX_CLIENT_OPERATION_MAP, TreeDxClient, parseFilename } from "../../../../support/client.ts";
export async function uploadBlobPartMethod(this: TreeDxClient, input: TreeDxBlobUploadPartRequest): Promise<TreeDxBlobUploadPart> {
    if (!this.token) {
        throw new TreeDxApiError('TreeDX bearer token is required.', {
            status: 401,
            code: 'missing_token',
        });
    }
    const response = await this.fetchWithTimeout(`${this.baseUrl}/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/blobs/uploads/${encodeURIComponent(input.uploadId)}/parts/${encodeURIComponent(input.partNumber)}`, {
        method: 'PUT',
        headers: {
            accept: 'application/json',
            authorization: `Bearer ${this.token}`,
            'content-type': 'application/octet-stream',
        },
        body: input.content,
    });
    const payload = await this.parseJsonResponse(response);
    if (!response.ok || (isRecord(payload) && payload.ok === false)) {
        this.throwApiError(response, payload);
    }
    return firstPayload<TreeDxBlobUploadPart>(payload, ['part']);
}
