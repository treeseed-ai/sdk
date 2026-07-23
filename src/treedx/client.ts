import { TreeDxApiError } from './errors.ts';
import type { SdkGraphSearchResult, TreeDxAuditEvent, TreeDxAuthMode, TreeDxBlob, TreeDxBlobUploadAbortRequest, TreeDxBlobUploadCompleteRequest, TreeDxBlobUploadCreateRequest, TreeDxBlobUploadPart, TreeDxBlobUploadPartRequest, TreeDxBlobUploadSession, TreeDxBlobDeleteRequest, TreeDxBlobDownload, TreeDxBlobDownloadRequest, TreeDxBlobMutationResult, TreeDxBlobReadRequest, TreeDxBlobUploadRequest, TreeDxBlobWriteRequest, TreeDxCapabilityGrant, TreeDxCommitRequest, TreeDxCommitResult, TreeDxContextRequest, TreeDxContextResult, TreeDxCtxParseRequest, TreeDxCtxParseResult, TreeDxDiff, TreeDxEffectiveScope, TreeDxEffectiveScopeRequest, TreeDxExecRequest, TreeDxExecResult, TreeDxFetchRemoteRequest, TreeDxFetchRemoteResult, TreeDxFederatedContextRequest, TreeDxFederatedContextResult, TreeDxFederatedGraphRequest, TreeDxFederatedGraphResult, TreeDxFederatedQueryRequest, TreeDxFederatedQueryResult, TreeDxFederatedSearchRequest, TreeDxFederatedSearchResult, TreeDxArtifact, TreeDxArtifactCleanupRequest, TreeDxArtifactCleanupResult, TreeDxArtifactDeleteRequest, TreeDxArtifactDownload, TreeDxArtifactExportRequest, TreeDxArtifactGetRequest, TreeDxArtifactListRequest, TreeDxFederationQueryPlan, TreeDxFederationQueryPlanRequest, TreeDxFile, TreeDxFileMutationResult, TreeDxGraphNodeRequest, TreeDxGraphQueryRequest, TreeDxGraphQueryResult, TreeDxGraphRefreshJob, TreeDxGraphRefreshJobRequest, TreeDxGraphRefreshRequest, TreeDxGraphRefreshResult, TreeDxGraphRelatedRequest, TreeDxGraphSearchRequest, TreeDxGraphSubgraphRequest, TreeDxHealth, TreeDxListTreeRequest, TreeDxMigration, TreeDxMigrationRequest, TreeDxMirrorHealthRequest, TreeDxMirrorHealthResult, TreeDxMirrorPromotionRequest, TreeDxMirrorPromotionResult, TreeDxMirrorSyncRequest, TreeDxMirrorSyncResult, TreeDxNode, TreeDxPatchFileRequest, TreeDxReadFileRequest, TreeDxRepository, TreeDxRepositoryPathsRequest, TreeDxRepositoryPlacement, TreeDxRepositoryQueryRequest, TreeDxRepositoryQueryResult, TreeDxRepositoryReadRequest, TreeDxRepositorySearchRequest, TreeDxSearchRequest, TreeDxSearchIndexCompactRequest, TreeDxSearchIndexCompactResult, TreeDxSearchIndexRefreshRequest, TreeDxSearchIndexRefreshResult, TreeDxSearchIndexStatus, TreeDxSearchIndexStatusRequest, TreeDxSearchResult, TreeDxSnapshot, TreeDxSnapshotBuildRequest, TreeDxStorageBackupRequest, TreeDxStorageBackupResult, TreeDxStorageCompactRequest, TreeDxStorageCompactResult, TreeDxStorageMigration, TreeDxStorageMigrationPlanRequest, TreeDxStorageMigrationRollbackRequest, TreeDxStorageRestoreRequest, TreeDxStorageRestoreResult, TreeDxStorageRestoreVerifyRequest, TreeDxStatus, TreeDxTreeEntry, TreeDxClientOptions, TreeDxPushRequest, TreeDxPushResult, TreeDxWhoami, TreeDxWorkspace, TreeDxCreateWorkspaceRequest, TreeDxDeleteFileRequest, TreeDxDeepHealth, TreeDxWorkspaceRequest, TreeDxWriteFileRequest, TreeDxMetrics, TreeDxReadiness, TreeDxRegisterRepositoryRequest, } from './types.ts';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export function normalizeBaseUrl(baseUrl: string) {
    return baseUrl.replace(/\/+$/u, '');
}
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isAbortError(error: unknown) {
    return error instanceof DOMException && error.name === 'AbortError'
        || error instanceof Error && error.name === 'AbortError';
}
export function stripOk<T>(payload: unknown): T {
    if (!isRecord(payload)) {
        return payload as T;
    }
    const { ok: _ok, ...rest } = payload;
    return rest as T;
}
export function firstPayload<T>(payload: unknown, keys: string[]): T {
    if (isRecord(payload)) {
        for (const key of keys) {
            if (key in payload) {
                return payload[key] as T;
            }
        }
    }
    return stripOk<T>(payload);
}
export const TREEDX_CLIENT_OPERATION_MAP = {
    health: 'getHealth',
    ready: 'getReadiness',
    deepHealth: 'getDeepHealth',
    adminDeepHealth: 'getAdminDeepHealth',
    metrics: 'getMetrics',
    prometheusMetrics: 'getPrometheusMetrics',
    whoami: 'getWhoami',
    authMode: 'getAuthMode',
    effectiveScope: 'getEffectiveScope',
    listCapabilities: 'listCapabilities',
    listCapabilityGrants: 'listCapabilityGrants',
    putCapabilityGrant: 'putCapabilityGrant',
    listAuditEvents: 'listAuditEvents',
    planFederatedQuery: 'planFederationQuery',
    buildSnapshot: 'buildSnapshot',
    getSnapshot: 'getSnapshot',
    exportArtifact: 'exportArtifact',
    syncMirror: 'syncMirror',
    fetchRemote: 'syncRepository',
    push: 'pushRepository',
    checkMirrorHealth: 'checkMirrorHealth',
    promoteMirror: 'promoteMirror',
    compactStorage: 'compactAdminStorage',
    backupStorage: 'backupAdminStorage',
    listStorageMigrations: 'listStorageMigrations',
    planStorageMigration: 'planStorageMigration',
    applyStorageMigration: 'applyStorageMigration',
    rollbackStorageMigration: 'rollbackStorageMigration',
    verifyStorageRestore: 'verifyStorageRestore',
    restoreStorage: 'restoreStorage',
    createMigration: 'createMigration',
    getMigration: 'getMigration',
    getNode: 'getLocalNode',
    listNodes: 'listRegistryNodes',
    getPlacement: 'getRepositoryPlacement',
    getRepository: 'getRepository',
    createWorkspace: 'createWorkspace',
    closeWorkspace: 'closeWorkspace',
    listTree: 'listWorkspaceTree',
    readFile: 'readWorkspaceFile',
    writeFile: 'writeWorkspaceFile',
    patchFile: 'patchWorkspaceFile',
    deleteFile: 'deleteWorkspaceFile',
    readBlob: 'readRepositoryBlob',
    writeBlob: 'writeWorkspaceBlob',
    deleteBlob: 'deleteWorkspaceBlob',
    downloadBlob: 'downloadWorkspaceBlob',
    uploadBlob: 'uploadWorkspaceBlob',
    createBlobUpload: 'createWorkspaceBlobUpload',
    uploadBlobPart: 'uploadWorkspaceBlobPart',
    completeBlobUpload: 'completeWorkspaceBlobUpload',
    abortBlobUpload: 'abortWorkspaceBlobUpload',
    listArtifacts: 'listArtifacts',
    getArtifact: 'getArtifact',
    deleteArtifact: 'deleteArtifact',
    cleanupArtifacts: 'cleanupArtifacts',
    search: 'searchWorkspace',
    status: 'getWorkspaceStatus',
    diff: 'getWorkspaceDiff',
    commit: 'commitWorkspace',
    exec: 'execWorkspace',
    readRepositoryFiles: 'readRepositoryFile',
    readRepositoryFile: 'readRepositoryFile',
    listRepositoryPaths: 'listRepositoryPaths',
    searchRepositoryFiles: 'searchRepositoryFiles',
    queryRepository: 'queryRepository',
    federatedSearch: 'federatedSearch',
    federatedQuery: 'federatedQuery',
    federatedContext: 'federatedContextBuild',
    federatedGraph: 'federatedGraphQuery',
    refreshGraph: 'refreshRepositoryGraph',
    getGraphRefreshJob: 'getGraphRefreshJob',
    refreshSearchIndex: 'refreshSearchIndex',
    getSearchIndexStatus: 'getSearchIndexStatus',
    compactSearchIndex: 'compactSearchIndex',
    queryGraph: 'queryRepositoryGraph',
    searchGraphFiles: 'searchGraphFiles',
    searchGraphSections: 'searchGraphSections',
    searchGraphEntities: 'searchGraphEntities',
    getGraphNode: 'getGraphNode',
    getRelated: 'getRelatedGraphNodes',
    getSubgraph: 'getGraphSubgraph',
    buildContext: 'buildContext',
    parseContextDsl: 'parseContextQuery',
} as const;
import * as extractedMethods from "./client/methods.ts";
export class TreeDxClient {
    readonly baseUrl: string;
    readonly token?: string;
    readonly defaultRepoId?: string;
    readonly fetchImpl: typeof fetch;
    constructor(readonly options: TreeDxClientOptions) {
        this.baseUrl = normalizeBaseUrl(options.baseUrl);
        this.token = options.token;
        this.defaultRepoId = options.repoId;
        this.fetchImpl = options.fetch ?? fetch;
    }
}
export interface TreeDxClient {
    repoId(inputRepoId?: string);
    query(params?: Record<string, unknown>);
    headers(bodyPresent: boolean);
    fetchWithTimeout(input: string, init: RequestInit): Promise<Response>;
    request<T>(method: HttpMethod, path: string, body?: unknown, options?: {
        query?: Record<string, string | number | boolean | null | undefined>;
        tokenRequired?: boolean;
    }): Promise<T>;
    requestBinary(path: string, body: unknown, options?: {
        query?: Record<string, string | number | boolean | null | undefined>;
        tokenRequired?: boolean;
    }): Promise<TreeDxArtifactDownload>;
    requestBlobDownload(input: TreeDxBlobDownloadRequest): Promise<TreeDxBlobDownload>;
    requestBlobUpload(input: TreeDxBlobUploadRequest): Promise<TreeDxBlobMutationResult>;
    assertBinaryOk(response: Response): Promise<void>;
    parseJsonResponse(response: Response): Promise<unknown>;
    throwApiError(response: Response, payload: unknown): never;
    health(): Promise<TreeDxHealth>;
    ready(): Promise<TreeDxReadiness>;
    deepHealth(input?: {
        admin?: boolean;
    }): Promise<TreeDxDeepHealth>;
    metrics(): Promise<TreeDxMetrics>;
    prometheusMetrics(): Promise<string>;
    whoami(): Promise<TreeDxWhoami>;
    authMode(): Promise<TreeDxAuthMode>;
    effectiveScope(input?: TreeDxEffectiveScopeRequest): Promise<TreeDxEffectiveScope>;
    listCapabilities(): Promise<{
        capabilities: string[];
    }>;
    listCapabilityGrants(input?: {
        actorId?: string;
        repoId?: string;
    }): Promise<TreeDxCapabilityGrant[]>;
    putCapabilityGrant(input: TreeDxCapabilityGrant): Promise<TreeDxCapabilityGrant>;
    listAuditEvents(input?: {
        actorId?: string;
        tenantId?: string;
        repoId?: string;
        eventType?: string;
        limit?: number;
    }): Promise<{
        events: TreeDxAuditEvent[];
        page: {
            limit: number;
            hasMore: boolean;
        };
    }>;
    planFederatedQuery(input: TreeDxFederationQueryPlanRequest): Promise<TreeDxFederationQueryPlan>;
    buildSnapshot(input?: TreeDxSnapshotBuildRequest): Promise<TreeDxSnapshot>;
    getSnapshot(input: {
        repoId?: string;
        snapshotId: string;
    }): Promise<TreeDxSnapshot>;
    exportArtifact(input?: TreeDxArtifactExportRequest): Promise<TreeDxArtifact>;
    downloadArtifact(input?: TreeDxArtifactExportRequest): Promise<TreeDxArtifactDownload>;
    syncMirror(input: TreeDxMirrorSyncRequest): Promise<TreeDxMirrorSyncResult>;
    fetchRemote(input: TreeDxFetchRemoteRequest): Promise<TreeDxFetchRemoteResult>;
    push(input: TreeDxPushRequest): Promise<TreeDxPushResult>;
    checkMirrorHealth(input: TreeDxMirrorHealthRequest): Promise<TreeDxMirrorHealthResult>;
    promoteMirror(input: TreeDxMirrorPromotionRequest): Promise<TreeDxMirrorPromotionResult>;
    compactStorage(input?: TreeDxStorageCompactRequest): Promise<TreeDxStorageCompactResult>;
    backupStorage(input?: TreeDxStorageBackupRequest): Promise<TreeDxStorageBackupResult>;
    listStorageMigrations(): Promise<{
        migrations: TreeDxStorageMigration[];
        manifest: Record<string, unknown>;
    }>;
    planStorageMigration(input?: TreeDxStorageMigrationPlanRequest): Promise<TreeDxStorageMigration>;
    applyStorageMigration(input?: TreeDxStorageMigrationPlanRequest): Promise<TreeDxStorageMigration>;
    rollbackStorageMigration(input: TreeDxStorageMigrationRollbackRequest): Promise<TreeDxStorageMigration>;
    verifyStorageRestore(input: TreeDxStorageRestoreVerifyRequest): Promise<TreeDxStorageRestoreResult['restore']>;
    restoreStorage(input: TreeDxStorageRestoreRequest): Promise<TreeDxStorageRestoreResult['restore']>;
    createMigration(input: TreeDxMigrationRequest): Promise<{
        migration: TreeDxMigration;
        placement?: TreeDxRepositoryPlacement;
    }>;
    getMigration(input: {
        repoId?: string;
        migrationId: string;
    }): Promise<TreeDxMigration>;
    getNode(): Promise<TreeDxNode>;
    listNodes(): Promise<TreeDxNode[]>;
    getPlacement(repoId: string): Promise<TreeDxRepositoryPlacement>;
    getRepository(repoId?: string): Promise<TreeDxRepository>;
    listRepositories(): Promise<TreeDxRepository[]>;
    registerRepository(input: TreeDxRegisterRepositoryRequest): Promise<TreeDxRepository>;
    createWorkspace(input: TreeDxCreateWorkspaceRequest): Promise<TreeDxWorkspace>;
    closeWorkspace(workspaceId: string): Promise<void>;
    listTree(input: TreeDxListTreeRequest): Promise<TreeDxTreeEntry[]>;
    readFile(input: TreeDxReadFileRequest): Promise<TreeDxFile>;
    writeFile(input: TreeDxWriteFileRequest): Promise<TreeDxFileMutationResult>;
    patchFile(input: TreeDxPatchFileRequest): Promise<TreeDxFileMutationResult>;
    deleteFile(input: TreeDxDeleteFileRequest): Promise<TreeDxFileMutationResult>;
    readBlob(input: TreeDxBlobReadRequest): Promise<TreeDxBlob>;
    writeBlob(input: TreeDxBlobWriteRequest): Promise<TreeDxBlobMutationResult>;
    deleteBlob(input: TreeDxBlobDeleteRequest): Promise<TreeDxBlobMutationResult>;
    downloadBlob(input: TreeDxBlobDownloadRequest): Promise<TreeDxBlobDownload>;
    uploadBlob(input: TreeDxBlobUploadRequest): Promise<TreeDxBlobMutationResult>;
    createBlobUpload(input: TreeDxBlobUploadCreateRequest): Promise<TreeDxBlobUploadSession>;
    uploadBlobPart(input: TreeDxBlobUploadPartRequest): Promise<TreeDxBlobUploadPart>;
    completeBlobUpload(input: TreeDxBlobUploadCompleteRequest): Promise<TreeDxBlobMutationResult>;
    abortBlobUpload(input: TreeDxBlobUploadAbortRequest): Promise<TreeDxBlobUploadSession>;
    listArtifacts(input?: TreeDxArtifactListRequest): Promise<TreeDxArtifact[]>;
    getArtifact(input: TreeDxArtifactGetRequest): Promise<TreeDxArtifact>;
    deleteArtifact(input: TreeDxArtifactDeleteRequest): Promise<TreeDxArtifact>;
    cleanupArtifacts(input?: TreeDxArtifactCleanupRequest): Promise<TreeDxArtifactCleanupResult>;
    search(input: TreeDxSearchRequest): Promise<TreeDxSearchResult>;
    status(input: TreeDxWorkspaceRequest): Promise<TreeDxStatus>;
    diff(input: TreeDxWorkspaceRequest): Promise<TreeDxDiff>;
    commit(input: TreeDxCommitRequest): Promise<TreeDxCommitResult>;
    exec(input: TreeDxExecRequest): Promise<TreeDxExecResult>;
    readRepositoryFiles(input: TreeDxRepositoryReadRequest): Promise<TreeDxRepositoryQueryResult>;
    readRepositoryFile(input: TreeDxRepositoryReadRequest): Promise<TreeDxRepositoryQueryResult>;
    listRepositoryPaths(input: TreeDxRepositoryPathsRequest): Promise<TreeDxRepositoryQueryResult>;
    searchRepositoryFiles(input: TreeDxRepositorySearchRequest): Promise<TreeDxRepositoryQueryResult>;
    queryRepository(input: TreeDxRepositoryQueryRequest): Promise<TreeDxRepositoryQueryResult>;
    federatedSearch(input: TreeDxFederatedSearchRequest): Promise<TreeDxFederatedSearchResult>;
    federatedQuery(input: TreeDxFederatedQueryRequest): Promise<TreeDxFederatedQueryResult>;
    federatedContext(input: TreeDxFederatedContextRequest): Promise<TreeDxFederatedContextResult>;
    federatedGraph(input: TreeDxFederatedGraphRequest): Promise<TreeDxFederatedGraphResult>;
    refreshGraph(input?: TreeDxGraphRefreshRequest): Promise<TreeDxGraphRefreshResult>;
    getGraphRefreshJob(input: TreeDxGraphRefreshJobRequest): Promise<TreeDxGraphRefreshJob>;
    refreshSearchIndex(input?: TreeDxSearchIndexRefreshRequest): Promise<TreeDxSearchIndexRefreshResult>;
    getSearchIndexStatus(input?: TreeDxSearchIndexStatusRequest): Promise<TreeDxSearchIndexStatus>;
    compactSearchIndex(input?: TreeDxSearchIndexCompactRequest): Promise<TreeDxSearchIndexCompactResult>;
    queryGraph(input: TreeDxGraphQueryRequest): Promise<TreeDxGraphQueryResult>;
    searchGraphFiles(input: TreeDxGraphSearchRequest): Promise<SdkGraphSearchResult[]>;
    searchGraphSections(input: TreeDxGraphSearchRequest): Promise<SdkGraphSearchResult[]>;
    searchGraphEntities(input: TreeDxGraphSearchRequest): Promise<SdkGraphSearchResult[]>;
    getGraphNode(input: TreeDxGraphNodeRequest);
    getRelated(input: TreeDxGraphRelatedRequest);
    getSubgraph(input: TreeDxGraphSubgraphRequest);
    buildContext(input: TreeDxContextRequest): Promise<TreeDxContextResult>;
    parseContextDsl(input: TreeDxCtxParseRequest): Promise<TreeDxCtxParseResult>;
    graphSearch(path: string, input: TreeDxGraphSearchRequest): Promise<SdkGraphSearchResult[]>;
}
TreeDxClient.prototype.repoId = extractedMethods.repoIdMethod;
TreeDxClient.prototype.query = extractedMethods.queryMethod;
TreeDxClient.prototype.headers = extractedMethods.headersMethod;
TreeDxClient.prototype.fetchWithTimeout = extractedMethods.fetchWithTimeoutMethod;
TreeDxClient.prototype.request = extractedMethods.requestMethod;
TreeDxClient.prototype.requestBinary = extractedMethods.requestBinaryMethod;
TreeDxClient.prototype.requestBlobDownload = extractedMethods.requestBlobDownloadMethod;
TreeDxClient.prototype.requestBlobUpload = extractedMethods.requestBlobUploadMethod;
TreeDxClient.prototype.assertBinaryOk = extractedMethods.assertBinaryOkMethod;
TreeDxClient.prototype.parseJsonResponse = extractedMethods.parseJsonResponseMethod;
TreeDxClient.prototype.throwApiError = extractedMethods.throwApiErrorMethod;
TreeDxClient.prototype.health = extractedMethods.healthMethod;
TreeDxClient.prototype.ready = extractedMethods.readyMethod;
TreeDxClient.prototype.deepHealth = extractedMethods.deepHealthMethod;
TreeDxClient.prototype.metrics = extractedMethods.metricsMethod;
TreeDxClient.prototype.prometheusMetrics = extractedMethods.prometheusMetricsMethod;
TreeDxClient.prototype.whoami = extractedMethods.whoamiMethod;
TreeDxClient.prototype.authMode = extractedMethods.authModeMethod;
TreeDxClient.prototype.effectiveScope = extractedMethods.effectiveScopeMethod;
TreeDxClient.prototype.listCapabilities = extractedMethods.listCapabilitiesMethod;
TreeDxClient.prototype.listCapabilityGrants = extractedMethods.listCapabilityGrantsMethod;
TreeDxClient.prototype.putCapabilityGrant = extractedMethods.putCapabilityGrantMethod;
TreeDxClient.prototype.listAuditEvents = extractedMethods.listAuditEventsMethod;
TreeDxClient.prototype.planFederatedQuery = extractedMethods.planFederatedQueryMethod;
TreeDxClient.prototype.buildSnapshot = extractedMethods.buildSnapshotMethod;
TreeDxClient.prototype.getSnapshot = extractedMethods.getSnapshotMethod;
TreeDxClient.prototype.exportArtifact = extractedMethods.exportArtifactMethod;
TreeDxClient.prototype.downloadArtifact = extractedMethods.downloadArtifactMethod;
TreeDxClient.prototype.syncMirror = extractedMethods.syncMirrorMethod;
TreeDxClient.prototype.fetchRemote = extractedMethods.fetchRemoteMethod;
TreeDxClient.prototype.push = extractedMethods.pushMethod;
TreeDxClient.prototype.checkMirrorHealth = extractedMethods.checkMirrorHealthMethod;
TreeDxClient.prototype.promoteMirror = extractedMethods.promoteMirrorMethod;
TreeDxClient.prototype.compactStorage = extractedMethods.compactStorageMethod;
TreeDxClient.prototype.backupStorage = extractedMethods.backupStorageMethod;
TreeDxClient.prototype.listStorageMigrations = extractedMethods.listStorageMigrationsMethod;
TreeDxClient.prototype.planStorageMigration = extractedMethods.planStorageMigrationMethod;
TreeDxClient.prototype.applyStorageMigration = extractedMethods.applyStorageMigrationMethod;
TreeDxClient.prototype.rollbackStorageMigration = extractedMethods.rollbackStorageMigrationMethod;
TreeDxClient.prototype.verifyStorageRestore = extractedMethods.verifyStorageRestoreMethod;
TreeDxClient.prototype.restoreStorage = extractedMethods.restoreStorageMethod;
TreeDxClient.prototype.createMigration = extractedMethods.createMigrationMethod;
TreeDxClient.prototype.getMigration = extractedMethods.getMigrationMethod;
TreeDxClient.prototype.getNode = extractedMethods.getNodeMethod;
TreeDxClient.prototype.listNodes = extractedMethods.listNodesMethod;
TreeDxClient.prototype.getPlacement = extractedMethods.getPlacementMethod;
TreeDxClient.prototype.getRepository = extractedMethods.getRepositoryMethod;
TreeDxClient.prototype.listRepositories = extractedMethods.listRepositoriesMethod;
TreeDxClient.prototype.registerRepository = extractedMethods.registerRepositoryMethod;
TreeDxClient.prototype.createWorkspace = extractedMethods.createWorkspaceMethod;
TreeDxClient.prototype.closeWorkspace = extractedMethods.closeWorkspaceMethod;
TreeDxClient.prototype.listTree = extractedMethods.listTreeMethod;
TreeDxClient.prototype.readFile = extractedMethods.readFileMethod;
TreeDxClient.prototype.writeFile = extractedMethods.writeFileMethod;
TreeDxClient.prototype.patchFile = extractedMethods.patchFileMethod;
TreeDxClient.prototype.deleteFile = extractedMethods.deleteFileMethod;
TreeDxClient.prototype.readBlob = extractedMethods.readBlobMethod;
TreeDxClient.prototype.writeBlob = extractedMethods.writeBlobMethod;
TreeDxClient.prototype.deleteBlob = extractedMethods.deleteBlobMethod;
TreeDxClient.prototype.downloadBlob = extractedMethods.downloadBlobMethod;
TreeDxClient.prototype.uploadBlob = extractedMethods.uploadBlobMethod;
TreeDxClient.prototype.createBlobUpload = extractedMethods.createBlobUploadMethod;
TreeDxClient.prototype.uploadBlobPart = extractedMethods.uploadBlobPartMethod;
TreeDxClient.prototype.completeBlobUpload = extractedMethods.completeBlobUploadMethod;
TreeDxClient.prototype.abortBlobUpload = extractedMethods.abortBlobUploadMethod;
TreeDxClient.prototype.listArtifacts = extractedMethods.listArtifactsMethod;
TreeDxClient.prototype.getArtifact = extractedMethods.getArtifactMethod;
TreeDxClient.prototype.deleteArtifact = extractedMethods.deleteArtifactMethod;
TreeDxClient.prototype.cleanupArtifacts = extractedMethods.cleanupArtifactsMethod;
TreeDxClient.prototype.search = extractedMethods.searchMethod;
TreeDxClient.prototype.status = extractedMethods.statusMethod;
TreeDxClient.prototype.diff = extractedMethods.diffMethod;
TreeDxClient.prototype.commit = extractedMethods.commitMethod;
TreeDxClient.prototype.exec = extractedMethods.execMethod;
TreeDxClient.prototype.readRepositoryFiles = extractedMethods.readRepositoryFilesMethod;
TreeDxClient.prototype.readRepositoryFile = extractedMethods.readRepositoryFileMethod;
TreeDxClient.prototype.listRepositoryPaths = extractedMethods.listRepositoryPathsMethod;
TreeDxClient.prototype.searchRepositoryFiles = extractedMethods.searchRepositoryFilesMethod;
TreeDxClient.prototype.queryRepository = extractedMethods.queryRepositoryMethod;
TreeDxClient.prototype.federatedSearch = extractedMethods.federatedSearchMethod;
TreeDxClient.prototype.federatedQuery = extractedMethods.federatedQueryMethod;
TreeDxClient.prototype.federatedContext = extractedMethods.federatedContextMethod;
TreeDxClient.prototype.federatedGraph = extractedMethods.federatedGraphMethod;
TreeDxClient.prototype.refreshGraph = extractedMethods.refreshGraphMethod;
TreeDxClient.prototype.getGraphRefreshJob = extractedMethods.getGraphRefreshJobMethod;
TreeDxClient.prototype.refreshSearchIndex = extractedMethods.refreshSearchIndexMethod;
TreeDxClient.prototype.getSearchIndexStatus = extractedMethods.getSearchIndexStatusMethod;
TreeDxClient.prototype.compactSearchIndex = extractedMethods.compactSearchIndexMethod;
TreeDxClient.prototype.queryGraph = extractedMethods.queryGraphMethod;
TreeDxClient.prototype.searchGraphFiles = extractedMethods.searchGraphFilesMethod;
TreeDxClient.prototype.searchGraphSections = extractedMethods.searchGraphSectionsMethod;
TreeDxClient.prototype.searchGraphEntities = extractedMethods.searchGraphEntitiesMethod;
TreeDxClient.prototype.getGraphNode = extractedMethods.getGraphNodeMethod;
TreeDxClient.prototype.getRelated = extractedMethods.getRelatedMethod;
TreeDxClient.prototype.getSubgraph = extractedMethods.getSubgraphMethod;
TreeDxClient.prototype.buildContext = extractedMethods.buildContextMethod;
TreeDxClient.prototype.parseContextDsl = extractedMethods.parseContextDslMethod;
TreeDxClient.prototype.graphSearch = extractedMethods.graphSearchMethod;
export function parseFilename(contentDisposition: string | null) {
    if (!contentDisposition) {
        return undefined;
    }
    const match = /filename="([^"]+)"/u.exec(contentDisposition) ?? /filename=([^;]+)/u.exec(contentDisposition);
    return match?.[1];
}
