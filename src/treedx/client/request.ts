import { TreeDxApiError } from ".././errors.ts";
import type { SdkGraphSearchResult, TreeDxAuditEvent, TreeDxAuthMode, TreeDxBlob, TreeDxBlobUploadAbortRequest, TreeDxBlobUploadCompleteRequest, TreeDxBlobUploadCreateRequest, TreeDxBlobUploadPart, TreeDxBlobUploadPartRequest, TreeDxBlobUploadSession, TreeDxBlobDeleteRequest, TreeDxBlobDownload, TreeDxBlobDownloadRequest, TreeDxBlobMutationResult, TreeDxBlobReadRequest, TreeDxBlobUploadRequest, TreeDxBlobWriteRequest, TreeDxCapabilityGrant, TreeDxCommitRequest, TreeDxCommitResult, TreeDxContextRequest, TreeDxContextResult, TreeDxCtxParseRequest, TreeDxCtxParseResult, TreeDxDiff, TreeDxEffectiveScope, TreeDxEffectiveScopeRequest, TreeDxExecRequest, TreeDxExecResult, TreeDxFetchRemoteRequest, TreeDxFetchRemoteResult, TreeDxFederatedContextRequest, TreeDxFederatedContextResult, TreeDxFederatedGraphRequest, TreeDxFederatedGraphResult, TreeDxFederatedQueryRequest, TreeDxFederatedQueryResult, TreeDxFederatedSearchRequest, TreeDxFederatedSearchResult, TreeDxArtifact, TreeDxArtifactCleanupRequest, TreeDxArtifactCleanupResult, TreeDxArtifactDeleteRequest, TreeDxArtifactDownload, TreeDxArtifactExportRequest, TreeDxArtifactGetRequest, TreeDxArtifactListRequest, TreeDxFederationQueryPlan, TreeDxFederationQueryPlanRequest, TreeDxFile, TreeDxFileMutationResult, TreeDxGraphNodeRequest, TreeDxGraphQueryRequest, TreeDxGraphQueryResult, TreeDxGraphRefreshJob, TreeDxGraphRefreshJobRequest, TreeDxGraphRefreshRequest, TreeDxGraphRefreshResult, TreeDxGraphRelatedRequest, TreeDxGraphSearchRequest, TreeDxGraphSubgraphRequest, TreeDxHealth, TreeDxListTreeRequest, TreeDxMigration, TreeDxMigrationRequest, TreeDxMirrorHealthRequest, TreeDxMirrorHealthResult, TreeDxMirrorPromotionRequest, TreeDxMirrorPromotionResult, TreeDxMirrorSyncRequest, TreeDxMirrorSyncResult, TreeDxNode, TreeDxPatchFileRequest, TreeDxReadFileRequest, TreeDxRepository, TreeDxRepositoryPathsRequest, TreeDxRepositoryPlacement, TreeDxRepositoryQueryRequest, TreeDxRepositoryQueryResult, TreeDxRepositoryReadRequest, TreeDxRepositorySearchRequest, TreeDxSearchRequest, TreeDxSearchIndexCompactRequest, TreeDxSearchIndexCompactResult, TreeDxSearchIndexRefreshRequest, TreeDxSearchIndexRefreshResult, TreeDxSearchIndexStatus, TreeDxSearchIndexStatusRequest, TreeDxSearchResult, TreeDxSnapshot, TreeDxSnapshotBuildRequest, TreeDxStorageBackupRequest, TreeDxStorageBackupResult, TreeDxStorageCompactRequest, TreeDxStorageCompactResult, TreeDxStorageMigration, TreeDxStorageMigrationPlanRequest, TreeDxStorageMigrationRollbackRequest, TreeDxStorageRestoreRequest, TreeDxStorageRestoreResult, TreeDxStorageRestoreVerifyRequest, TreeDxStatus, TreeDxTreeEntry, TreeDxClientOptions, TreeDxPushRequest, TreeDxPushResult, TreeDxWhoami, TreeDxWorkspace, TreeDxCreateWorkspaceRequest, TreeDxDeleteFileRequest, TreeDxDeepHealth, TreeDxWorkspaceRequest, TreeDxWriteFileRequest, TreeDxMetrics, TreeDxReadiness, TreeDxRegisterRepositoryRequest, } from ".././types.ts";
import { HttpMethod, normalizeBaseUrl, isRecord, isAbortError, stripOk, firstPayload, TREEDX_CLIENT_OPERATION_MAP, TreeDxClient, parseFilename } from "../client.ts";
export async function requestMethod<T>(this: TreeDxClient, method: HttpMethod, path: string, body?: unknown, options: {
    query?: Record<string, string | number | boolean | null | undefined>;
    tokenRequired?: boolean;
} = {}): Promise<T> {
    if (options.tokenRequired && !this.token) {
        throw new TreeDxApiError('TreeDX bearer token is required.', {
            status: 401,
            code: 'missing_token',
        });
    }
    const response = await this.fetchWithTimeout(`${this.baseUrl}${path}${this.query(options.query ?? {})}`, {
        method,
        headers: this.headers(body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let payload: unknown;
    try {
        payload = await response.json();
    }
    catch (error) {
        throw new TreeDxApiError('TreeDX response was not valid JSON.', {
            status: response.status,
            code: 'invalid_response',
            payload: error,
        });
    }
    if (!response.ok || (isRecord(payload) && payload.ok === false)) {
        const errorBody = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
        throw new TreeDxApiError(typeof errorBody.message === 'string'
            ? errorBody.message
            : `TreeDX request failed with status ${response.status}.`, {
            status: response.status,
            code: typeof errorBody.code === 'string' ? errorBody.code : 'treedx_api_error',
            details: isRecord(errorBody.details) ? errorBody.details : {},
            payload,
        });
    }
    return stripOk<T>(payload);
}
