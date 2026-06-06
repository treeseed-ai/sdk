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
} from '../sdk-types.ts';
import type { components, operations, paths } from './generated/openapi-types.ts';

export interface TreeDxActor {
	actorId: string;
	tenantId: string;
}

export interface TreeDxClientOptions {
	baseUrl: string;
	token?: string;
	repoId?: string;
	fetch?: typeof fetch;
	defaultRef?: string;
	defaultActor?: TreeDxActor;
	timeoutMs?: number;
}

export type TreeDxErrorCode =
	| components['schemas']['TreeDxErrorCode']
	| 'missing_repo_id'
	| 'missing_token'
	| 'invalid_response'
	| 'treedx_api_error'
	| 'model_not_content_backed'
	| 'operation_not_allowed'
	| 'missing_content_path_mapping'
	| 'not_implemented'
	| 'workspace_required'
	| 'node_not_configured'
	| 'unsupported_treedx_graph_operation'
	| (string & {});

export interface TreeDxOkEnvelope<T> {
	ok: true;
	[key: string]: unknown;
}

export interface TreeDxErrorBody {
	code: string;
	message: string;
	details?: Record<string, unknown>;
}

export interface TreeDxErrorEnvelope {
	ok: false;
	error: TreeDxErrorBody;
}

export function assertTreeDxOk<T extends Record<string, unknown>>(
	value: unknown,
	label = 'TreeDX response',
): asserts value is T & { ok: true } {
	if (typeof value !== 'object' || value === null || Array.isArray(value) || (value as { ok?: unknown }).ok !== true) {
		throw new Error(`${label} was not an ok TreeDX response.`);
	}
}

export interface TreeDxHealth {
	status: string;
	service: string;
	dataDir?: string;
}

export type TreeDxReadiness = components['schemas']['TreeDxReadiness'];
export type TreeDxDeepHealth = components['schemas']['TreeDxHealthSummary'];
export type TreeDxMetrics = components['schemas']['TreeDxMetrics'];

export interface TreeDxVersion {
	service: string;
	version: string;
	apiVersion: string;
}

export interface TreeDxPrincipal {
	actorId: string;
	tenantId: string;
	authMode?: string;
}

export interface TreeDxWhoami {
	authenticated: boolean;
	principal: TreeDxPrincipal | null;
}

export interface TreeDxEffectiveScopeRequest {
	repoId?: string;
}

export interface TreeDxEffectiveScope {
	actorId: string;
	tenantIds: string[];
	repoId?: string | null;
	capabilities: string[];
	refs: string[];
	paths: string[];
	policyVersion?: string;
	policyHash?: string;
}

export interface TreeDxAuthMode {
	mode: 'dev' | 'connected';
	connected: boolean;
	verifier?: {
		type: 'jwt_hs256' | 'hs256_dev' | 'jwks_oidc' | 'trusted_internal';
		issuer?: string;
		jwksUrl?: string;
	};
}

export interface TreeDxCapabilityGrant {
	id?: string;
	actorId: string;
	tenantId: string;
	repoIds: string[];
	capabilities: string[];
	refs: string[];
	paths: string[];
	expiresAt?: string | null;
	revokedAt?: string | null;
	revokedByActorId?: string | null;
	revocationReason?: string | null;
}

export interface TreeDxAuditEvent {
	id: string;
	eventType: string;
	actorId?: string | null;
	tenantId?: string | null;
	repoId?: string | null;
	nodeId?: string | null;
	workspaceId?: string | null;
	operation?: string | null;
	status?: string | null;
	requestId?: string | null;
	requestedScope?: Record<string, unknown> | null;
	effectiveScope?: Record<string, unknown> | null;
	data: Record<string, unknown>;
	recordedAt: string;
}

export interface TreeDxFederationQueryPlanRequest {
	repoIds: string[];
	refs?: Record<string, string>;
	paths?: Record<string, string[]>;
	queryType?: string;
	capabilities?: string[];
}

export interface TreeDxFederationQueryPlan {
	requestedScope: Record<string, unknown>;
	effectiveScope: Record<string, unknown>;
	rejected: Array<Record<string, unknown>>;
	executable: false;
	reason: string;
}

export interface TreeDxNode {
	id: string;
	baseUrl: string;
	role: string;
	health: string;
}

export interface TreeDxRepositoryPlacement {
	repositoryId?: string;
	repoId?: string;
	primaryNodeId: string;
	mirrorNodeIds: string[];
	readPolicy: string;
	writePolicy: string;
	migrationState: string;
}

export interface TreeDxMirror {
	id?: string;
	repositoryId?: string;
	repoId?: string;
	sourceNodeId: string;
	targetNodeId: string;
	mode: string;
	lastSeenCommit?: string | null;
	behindBy?: number | null;
	status: string;
}

export interface TreeDxRepository {
	repoId: string;
	name: string;
	defaultRef: string;
	status: string;
	remoteUrl?: string | null;
}

export interface TreeDxRef {
	name: string;
	target?: string | null;
	sha?: string | null;
	kind: string;
}

export interface TreeDxRemote {
	name: string;
	url?: string | null;
}

export interface TreeDxRepositoryStatus {
	repo: TreeDxRepository;
	git: Record<string, unknown>;
	placement?: TreeDxRepositoryPlacement | null;
}

export interface TreeDxCreateWorkspaceRequest {
	repoId?: string;
	baseRef?: string;
	branchName?: string;
	mode?: 'writable' | 'read_only';
	allowedPaths?: string[];
	ttlSeconds?: number;
}

export interface TreeDxWorkspace {
	workspaceId: string;
	repoId: string;
	baseRef: string;
	baseCommitSha: string;
	branchName?: string | null;
	mode: 'writable' | 'read_only';
	status: string;
	allowedPaths: string[];
	commitSha?: string | null;
	policyVersion?: string;
	policyHash?: string;
	revokedAt?: string | null;
	revokedReason?: string | null;
}

export interface TreeDxWorkspaceRequest {
	workspaceId: string;
}

export interface TreeDxListTreeRequest extends TreeDxWorkspaceRequest {
	path?: string;
	includeDeleted?: boolean;
}

export interface TreeDxTreeEntry {
	path: string;
	name: string;
	kind: 'blob' | 'tree';
	status?: string;
	source?: 'base' | 'overlay';
	objectId?: string | null;
	contentHash?: string | null;
}

export interface TreeDxReadFileRequest extends TreeDxWorkspaceRequest {
	path: string;
	allowProtected?: boolean;
}

export interface TreeDxFile {
	path: string;
	encoding: 'utf8' | 'base64';
	content: string;
	sha: string;
	source: 'base' | 'overlay';
	stat?: {
		size: number;
		mtime?: string | null;
	};
}

export interface TreeDxWriteFileRequest extends TreeDxWorkspaceRequest {
	path: string;
	encoding?: 'utf8';
	content: string;
	expectedSha?: string;
	allowProtected?: boolean;
}

export interface TreeDxPatchFileRequest extends TreeDxWorkspaceRequest {
	path: string;
	patch: string;
	expectedSha?: string;
	allowProtected?: boolean;
}

export interface TreeDxDeleteFileRequest extends TreeDxWorkspaceRequest {
	path: string;
	expectedSha?: string;
	allowProtected?: boolean;
}

export interface TreeDxFileMutationResult {
	path: string;
	status?: string;
	file?: {
		path: string;
		encoding?: string;
		sha?: string;
		size?: number;
		source?: string;
	};
}

export interface TreeDxBlobReadRequest {
	repoId?: string;
	ref?: string;
	path: string;
	encoding?: 'base64';
	expectedContentHash?: string;
	allowProtected?: boolean;
}

export interface TreeDxBlobWriteRequest extends TreeDxWorkspaceRequest {
	path: string;
	encoding?: 'base64';
	contentBase64: string;
	contentType?: string;
	expectedSha?: string;
	expectedContentHash?: string;
	allowProtected?: boolean;
}

export interface TreeDxBlobDeleteRequest extends TreeDxWorkspaceRequest {
	path: string;
	expectedSha?: string;
	allowProtected?: boolean;
}

export interface TreeDxBlobDownloadRequest extends TreeDxWorkspaceRequest {
	path: string;
	allowProtected?: boolean;
}

export interface TreeDxBlobUploadRequest extends TreeDxWorkspaceRequest {
	path: string;
	content: ArrayBuffer | Uint8Array | Blob;
	contentType?: string;
	expectedSha?: string;
	expectedContentHash?: string;
	allowProtected?: boolean;
}

export interface TreeDxBlob {
	path: string;
	encoding: 'base64';
	contentBase64: string;
	objectId?: string | null;
	sha?: string | null;
	contentHash: string;
	byteLength: number;
	contentType: string;
	source: 'base' | 'workspace';
}

export interface TreeDxBlobMutationResult {
	workspaceId: string;
	path: string;
	op: 'put' | 'delete';
	encoding?: 'base64';
	contentHash?: string | null;
	byteLength?: number;
	contentType?: string | null;
}

export interface TreeDxBlobDownload {
	content: ArrayBuffer;
	contentType: string | null;
	contentHash?: string;
	objectId?: string;
	source?: 'base' | 'workspace';
}

export interface TreeDxBlobUploadSession {
	uploadId: string;
	workspaceId: string;
	path: string;
	contentType?: string | null;
	expectedContentHash?: string | null;
	expectedSha?: string | null;
	createdAt: string;
	expiresAt: string;
	status: 'open' | 'completed' | 'aborted' | string;
}

export interface TreeDxBlobUploadCreateRequest extends TreeDxWorkspaceRequest {
	path: string;
	contentType?: string;
	expectedSha?: string;
	expectedContentHash?: string;
	allowProtected?: boolean;
}

export interface TreeDxBlobUploadPartRequest extends TreeDxWorkspaceRequest {
	uploadId: string;
	partNumber: number;
	content: ArrayBuffer | Uint8Array | Blob;
}

export interface TreeDxBlobUploadCompleteRequest extends TreeDxWorkspaceRequest {
	uploadId: string;
	expectedSha?: string;
	expectedContentHash?: string;
	allowProtected?: boolean;
	contentType?: string;
}

export interface TreeDxBlobUploadAbortRequest extends TreeDxWorkspaceRequest {
	uploadId: string;
}

export interface TreeDxBlobUploadPart {
	uploadId: string;
	workspaceId: string;
	partNumber: number;
	byteLength: number;
	contentHash: string;
	createdAt: string;
}

export interface TreeDxSearchRequest extends TreeDxWorkspaceRequest {
	query: string;
	path?: string;
	limit?: number;
	caseSensitive?: boolean;
}

export interface TreeDxSearchResult {
	results: Array<{
		path: string;
		line: number;
		column: number;
		snippet: string;
		source: 'base' | 'overlay';
	}>;
	truncated?: boolean;
}

export interface TreeDxStatus {
	workspaceId: string;
	status: string;
	changes: Array<Record<string, unknown>>;
}

export interface TreeDxDiff {
	workspaceId: string;
	diff: string;
	changedPaths: string[];
}

export interface TreeDxCommitRequest extends TreeDxWorkspaceRequest {
	message: string;
	author: {
		name: string;
		email: string;
	};
	indexPolicy?: string;
}

export interface TreeDxCommitResult {
	repoId: string;
	workspaceId: string;
	branchName: string;
	commitSha: string;
	changedPaths: string[];
	status: 'committed';
}

export interface TreeDxExecRequest extends TreeDxWorkspaceRequest {
	cmd: string;
	mode?: 'read_only' | 'verification' | 'write_limited';
	timeoutMs?: number;
	maxOutputBytes?: number;
	network?: 'none' | 'host';
	resourceLimits?: {
		cpu?: number;
		memoryMb?: number;
		pids?: number;
	};
}

export interface TreeDxExecResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	elapsedMs: number;
	truncated: boolean;
	changedPaths: string[];
	sandbox?: {
		backend: 'direct_dev' | 'container_sandbox' | 'external_worker' | string;
		network: string;
		resourceLimits?: {
			cpu?: number;
			memoryMb?: number;
			pids?: number;
		};
		isolated: boolean;
	};
}

export interface TreeDxRepositoryReadRequest {
	repoId?: string;
	ref?: string;
	path?: string;
	paths?: string[];
	encoding?: 'utf8' | 'base64';
	parseFrontmatter?: boolean;
	allowProtected?: boolean;
}

export interface TreeDxRepositoryPathsRequest {
	repoId?: string;
	ref?: string;
	paths?: string[];
	kinds?: Array<'blob' | 'tree'>;
	extensions?: string[];
	limit?: number;
	cursor?: string | null;
	allowProtected?: boolean;
}

export interface TreeDxRepositorySearchRequest {
	repoId?: string;
	ref?: string;
	paths?: string[];
	query: string;
	filters?: Array<{ field: string; op: string; value: unknown }>;
	sort?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
	limit?: number;
	cursor?: string | null;
	caseSensitive?: boolean;
	includeBody?: boolean;
	includeFrontmatter?: boolean;
	allowProtected?: boolean;
	includeDiagnostics?: boolean;
	diagnosticsLevel?: 'none' | 'summary' | 'ranking';
}

export interface TreeDxRepositoryQueryRequest {
	repoId?: string;
	ref?: string;
	type?: 'path' | 'text' | 'frontmatter' | 'section' | 'link' | 'changed_path' | 'combined';
	paths?: string[];
	path?: string;
	query?: string;
	filters?: Array<{ field: string; op: string; value: unknown }>;
	sort?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
	limit?: number;
	cursor?: string | null;
	baseRef?: string;
	allowProtected?: boolean;
	includeBody?: boolean;
	includeFrontmatter?: boolean;
	parseFrontmatter?: boolean;
	encoding?: 'utf8' | 'base64';
	includeDiagnostics?: boolean;
	diagnosticsLevel?: 'none' | 'summary' | 'ranking';
}

export interface TreeDxRankingDiagnostics {
	level: 'none' | 'summary' | 'ranking';
	authorizedResultCount: number;
	returnedResultCount: number;
	searchedPatterns?: string[];
	scoreFactors?: unknown;
}

export interface TreeDxRepositoryQueryResult {
	repoId: string;
	ref: string;
	resolvedRef: string;
	query?: string;
	results?: unknown[];
	entries?: unknown[];
	file?: unknown;
	files?: unknown[];
	diagnostics?: TreeDxRankingDiagnostics;
	page?: {
		limit: number;
		nextCursor: string | null;
		hasMore: boolean;
	};
}

export interface TreeDxGraphRefreshRequest extends SdkGraphRefreshRequest {
	repoId?: string;
	ref?: string;
	allowProtected?: boolean;
	force?: boolean;
	incremental?: boolean;
	changedPaths?: string[];
	baseGraphVersion?: string;
	forceFull?: boolean;
}

export type TreeDxGraphRefreshResult = SdkGraphRefreshPayload & {
	repoId: string;
	ref: string;
	resolvedRef: string;
	graphVersion: string;
	jobId?: string;
	refreshMode?: 'full' | 'incremental';
	fallbackReason?: string | null;
	changedPathCount?: number;
	indexedPathCount?: number;
	removedPathCount?: number;
	stale?: boolean;
};

export interface TreeDxGraphRefreshJobRequest {
	repoId?: string;
	ref?: string;
	jobId: string;
}

export interface TreeDxGraphRefreshJob {
	jobId: string;
	repoId: string;
	ref: string;
	requestedPaths: string[];
	changedPaths: string[];
	baseGraphVersion?: string | null;
	graphVersion?: string | null;
	refreshMode: 'full' | 'incremental';
	fallbackReason?: string | null;
	stale: boolean;
	status: 'running' | 'completed' | 'failed';
	startedAt: string;
	completedAt?: string | null;
	indexedPathCount: number;
	removedPathCount: number;
	errorCode?: string | null;
}

export type TreeDxContextMode = 'brief' | 'detailed' | 'citations' | 'mixed';

export interface TreeDxContextBudgetDiagnostics {
	requestedMaxNodes: number;
	usedNodes: number;
	requestedMaxTokens: number;
	estimatedTokens: number;
	truncated: boolean;
}

export interface TreeDxSearchIndexRefreshRequest {
	repoId?: string;
	ref?: string;
	paths?: string[];
	allowProtected?: boolean;
}

export interface TreeDxSearchIndexRefreshResult {
	repoId: string;
	ref: string;
	resolvedRef: string;
	indexVersion: string;
	graphVersion?: string | null;
	segmentIds: string[];
	indexedPathCount: number;
	sourceCommit?: string | null;
	stale: boolean;
}

export interface TreeDxSearchIndexStatusRequest {
	repoId?: string;
	ref?: string;
}

export interface TreeDxSearchIndexStatus {
	repoId: string;
	ref: string;
	resolvedRef: string;
	ready: boolean;
	indexVersion?: string | null;
	graphVersion?: string | null;
	segmentIds: string[];
	indexedPathCount: number;
	segmentCount: number;
	sourceCommit?: string | null;
	stale: boolean;
}

export interface TreeDxSearchIndexCompactRequest {
	repoId?: string;
	ref?: string;
	dryRun?: boolean;
}

export interface TreeDxSearchIndexCompactResult {
	repoId: string;
	ref: string;
	dryRun: boolean;
	segmentsBefore: number;
	segmentsAfter: number;
	compacted: boolean;
}

export interface TreeDxGraphSearchRequest {
	repoId?: string;
	ref?: string;
	query: string;
	limit?: number;
	options?: SdkGraphSearchOptions;
}

export interface TreeDxGraphNodeRequest {
	repoId?: string;
	ref?: string;
	nodeId: string;
}

export interface TreeDxGraphRelatedRequest {
	repoId?: string;
	ref?: string;
	nodeId: string;
	relations?: string[];
	options?: Record<string, unknown>;
}

export interface TreeDxGraphSubgraphRequest {
	repoId?: string;
	ref?: string;
	seedIds: string[];
	options?: Record<string, unknown>;
}

export interface TreeDxGraphQueryRequest extends SdkGraphQueryRequest {
	repoId?: string;
	ref?: string;
}

export type TreeDxGraphQueryResult = SdkGraphQueryResult & {
	repoId: string;
	graphVersion: string;
};

export interface TreeDxContextRequest extends SdkContextPackRequest {
	repoId?: string;
	ref?: string;
	mode?: TreeDxContextMode;
}

export type TreeDxContextResult = SdkContextPack & {
	repoId: string;
	graphVersion: string;
	mode?: TreeDxContextMode;
	diagnostics?: {
		mode?: TreeDxContextMode;
		budget?: TreeDxContextBudgetDiagnostics;
		provenancePaths?: string[];
		[key: string]: unknown;
	};
};

export interface TreeDxCtxParseRequest {
	repoId?: string;
	ref?: string;
	source: string;
}

export type TreeDxCtxParseResult = SdkGraphDslParseResult;

export interface TreeDxFederatedScopeInput {
	repoIds?: string[];
	refs?: Record<string, string>;
	paths?: Record<string, string[]>;
	includeErrors?: boolean;
	timeoutMs?: number;
	limit?: number;
	cursor?: string | null;
}

export interface TreeDxFederatedError {
	repoId?: string;
	nodeId?: string;
	code: string;
	message: string;
	status?: number;
}

export interface TreeDxFederatedDiagnostics {
	requestedRepoCount: number;
	executedRepoCount: number;
	rejectedRepoCount: number;
	partialFailureCount: number;
	routing: Array<{
		repoId?: string;
		nodeId?: string;
		source: 'local' | 'remote';
		status: 'ok' | 'rejected' | 'partial_failure';
		error?: { code: string };
	}>;
}

export interface TreeDxFederatedSearchRequest extends TreeDxFederatedScopeInput {
	repoId?: string;
	query: string;
	filters?: unknown[];
	sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;
}

export interface TreeDxFederatedSearchResult {
	query: string;
	results: Array<Record<string, unknown> & { repoId: string; ref: string; source: 'local' | 'remote' }>;
	page: { limit: number; hasMore: boolean; cursor?: string | null };
	diagnostics: TreeDxFederatedDiagnostics;
	errors?: TreeDxFederatedError[];
}

export interface TreeDxFederatedQueryRequest extends TreeDxFederatedScopeInput {
	repoId?: string;
	type: 'path' | 'text' | 'frontmatter' | 'section' | 'link' | 'changed_path' | 'combined';
	query?: string;
	filters?: unknown[];
	sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;
}

export interface TreeDxFederatedQueryResult {
	type: string;
	results: Array<Record<string, unknown> & { repoId: string; ref: string; source: 'local' | 'remote' }>;
	page: { limit: number; hasMore: boolean; cursor?: string | null };
	diagnostics: TreeDxFederatedDiagnostics;
	errors?: TreeDxFederatedError[];
}

export interface TreeDxFederatedContextRequest extends TreeDxFederatedScopeInput {
	query?: string;
	seedIds?: string[];
	seeds?: unknown[];
	relations?: unknown[];
	scopePaths?: string[];
	budget?: Record<string, unknown>;
}

export interface TreeDxFederatedContextResult {
	nodes: unknown[];
	edges: unknown[];
	files?: unknown[];
	sections?: unknown[];
	diagnostics: TreeDxFederatedDiagnostics & Record<string, unknown>;
	errors?: TreeDxFederatedError[];
}

export interface TreeDxFederatedGraphRequest extends TreeDxFederatedScopeInput {
	query?: string;
	seedIds?: string[];
	seeds?: unknown[];
	relations?: unknown[];
	scopePaths?: string[];
	options?: Record<string, unknown>;
}

export interface TreeDxFederatedGraphResult {
	nodes: unknown[];
	edges: unknown[];
	diagnostics: TreeDxFederatedDiagnostics & { crossRepoEdgeCount?: number };
	errors?: TreeDxFederatedError[];
}

export type TreeDxSnapshotKind =
	| 'repository_snapshot'
	| 'index_snapshot'
	| 'graph_snapshot'
	| 'search_snapshot'
	| 'audit_export';

export interface TreeDxSnapshotFile {
	path: string;
	objectId: string;
	size: number;
	contentHash: string;
}

export interface TreeDxArtifact {
	artifactId: string;
	snapshotId: string;
	repoId: string;
	format: 'tar.zst';
	size: number;
	checksum: string;
	uri: string;
	downloadUrl?: string;
	createdAt?: string;
	status?: string;
}

export interface TreeDxArtifactListRequest {
	repoId?: string;
}

export interface TreeDxArtifactGetRequest {
	repoId?: string;
	artifactId: string;
}

export interface TreeDxArtifactDeleteRequest {
	repoId?: string;
	artifactId: string;
}

export interface TreeDxArtifactCleanupRequest {
	retentionDays?: number;
}

export interface TreeDxArtifactCleanupResult {
	deletedCount: number;
	retentionDays: number;
}

export interface TreeDxSnapshot {
	snapshotId: string;
	repoId: string;
	ref: string;
	commitSha: string;
	kind: TreeDxSnapshotKind;
	includedPaths: string[];
	graphVersion?: string | null;
	fileCount: number;
	totalBytes: number;
	files?: TreeDxSnapshotFile[];
	checksums: Record<string, unknown>;
	artifact?: TreeDxArtifact | null;
	createdAt: string;
}

export interface TreeDxSnapshotBuildRequest {
	repoId?: string;
	ref?: string;
	kind?: TreeDxSnapshotKind;
	paths?: string[];
	allowProtected?: boolean;
	includeGraph?: boolean;
}

export interface TreeDxArtifactExportRequest extends TreeDxSnapshotBuildRequest {
	snapshotId?: string;
}

export interface TreeDxArtifactDownload {
	content: ArrayBuffer;
	contentType: string | null;
	filename?: string;
	checksum?: string;
	snapshotId?: string;
}

export interface TreeDxMirrorSyncRequest {
	repoId?: string;
	mirrorId: string;
	remoteName?: string;
	remoteUrl?: string;
	credentialId?: string;
	refspecs?: string[];
	dryRun?: boolean;
}

export interface TreeDxMirrorSyncResult {
	mirror: TreeDxMirror;
	sync: Record<string, unknown>;
}

export interface TreeDxFetchRemoteRequest {
	repoId?: string;
	remoteName?: string;
	remoteUrl?: string;
	credentialId?: string;
	refspecs?: string[];
	dryRun?: boolean;
}

export interface TreeDxFetchRemoteResult {
	fetch: {
		repoId?: string;
		remoteName: string;
		remoteUrl?: string | null;
		refspecs: string[];
		updatedRefs: string[];
		receivedPack?: boolean;
		beforeHead?: string | null;
		afterHead?: string | null;
		status: string;
	};
}

export interface TreeDxPushRequest extends TreeDxFetchRemoteRequest {
	refspecs: string[];
	expectedRemoteHead?: string | null;
}

export interface TreeDxPushResult {
	repoId?: string;
	remoteName: string;
	remoteUrl?: string | null;
	refspecs: string[];
	dryRun?: boolean;
	backend: string;
	status: 'dry_run' | 'pushed' | string;
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
	dryRun?: boolean;
	requireSynced?: boolean;
}

export interface TreeDxMirrorPromotionResult {
	promotion: {
		mirrorId: string;
		repoId: string;
		dryRun: boolean;
		status: 'planned' | 'promoted' | string;
		previousPlacement?: TreeDxRepositoryPlacement | null;
		resultingPlacement?: TreeDxRepositoryPlacement | null;
	};
}

export interface TreeDxStorageCompactRequest {
	logs?: string[];
	dryRun?: boolean;
	backupBefore?: boolean;
}

export interface TreeDxStorageCompactResult {
	compact: {
		status: string;
		dryRun: boolean;
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
	dryRun?: boolean;
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
	dryRun?: boolean;
	backupBeforeRestore?: boolean;
	force?: boolean;
}

export interface TreeDxStorageRestoreResult {
	restore: {
		restoreId?: string;
		backupId: string;
		dryRun: boolean;
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
	dryRun?: boolean;
	requireMirrorSynced?: boolean;
}

export interface TreeDxMigration {
	id: string;
	repositoryId: string;
	sourceNodeId: string;
	targetNodeId: string;
	mode: string;
	status: string;
	dryRun: boolean;
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
