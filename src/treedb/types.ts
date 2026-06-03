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

export interface TreeDbActor {
	actorId: string;
	tenantId: string;
}

export interface TreeDbClientOptions {
	baseUrl: string;
	token?: string;
	repoId?: string;
	fetch?: typeof fetch;
	defaultRef?: string;
	defaultActor?: TreeDbActor;
}

export interface TreeDbOkEnvelope<T> {
	ok: true;
	[key: string]: unknown;
}

export interface TreeDbErrorBody {
	code: string;
	message: string;
	details?: Record<string, unknown>;
}

export interface TreeDbErrorEnvelope {
	ok: false;
	error: TreeDbErrorBody;
}

export function assertTreeDbOk<T extends Record<string, unknown>>(
	value: unknown,
	label = 'TreeDB response',
): asserts value is T & { ok: true } {
	if (typeof value !== 'object' || value === null || Array.isArray(value) || (value as { ok?: unknown }).ok !== true) {
		throw new Error(`${label} was not an ok TreeDB response.`);
	}
}

export interface TreeDbHealth {
	status: string;
	service: string;
	dataDir?: string;
}

export interface TreeDbVersion {
	service: string;
	version: string;
	apiVersion: string;
}

export interface TreeDbPrincipal {
	actorId: string;
	tenantId: string;
	authMode?: string;
}

export interface TreeDbWhoami {
	authenticated: boolean;
	principal: TreeDbPrincipal | null;
}

export interface TreeDbEffectiveScopeRequest {
	repoId?: string;
}

export interface TreeDbEffectiveScope {
	actorId: string;
	tenantIds: string[];
	repoId?: string | null;
	capabilities: string[];
	refs: string[];
	paths: string[];
	policyVersion?: string;
	policyHash?: string;
}

export interface TreeDbAuthMode {
	mode: 'dev' | 'connected';
	connected: boolean;
	verifier?: {
		type: 'jwt_hs256' | 'hs256_dev' | 'jwks_oidc' | 'trusted_internal';
		issuer?: string;
		jwksUrl?: string;
	};
}

export interface TreeDbCapabilityGrant {
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

export interface TreeDbAuditEvent {
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

export interface TreeDbFederationQueryPlanRequest {
	repoIds: string[];
	refs?: Record<string, string>;
	paths?: Record<string, string[]>;
	queryType?: string;
	capabilities?: string[];
}

export interface TreeDbFederationQueryPlan {
	requestedScope: Record<string, unknown>;
	effectiveScope: Record<string, unknown>;
	rejected: Array<Record<string, unknown>>;
	executable: false;
	reason: string;
}

export interface TreeDbNode {
	id: string;
	baseUrl: string;
	role: string;
	health: string;
}

export interface TreeDbRepositoryPlacement {
	repositoryId?: string;
	repoId?: string;
	primaryNodeId: string;
	mirrorNodeIds: string[];
	readPolicy: string;
	writePolicy: string;
	migrationState: string;
}

export interface TreeDbMirror {
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

export interface TreeDbRepository {
	repoId: string;
	name: string;
	defaultRef: string;
	status: string;
	remoteUrl?: string | null;
}

export interface TreeDbRef {
	name: string;
	target?: string | null;
	sha?: string | null;
	kind: string;
}

export interface TreeDbRemote {
	name: string;
	url?: string | null;
}

export interface TreeDbRepositoryStatus {
	repo: TreeDbRepository;
	git: Record<string, unknown>;
	placement?: TreeDbRepositoryPlacement | null;
}

export interface TreeDbCreateWorkspaceRequest {
	repoId?: string;
	baseRef?: string;
	branchName?: string;
	mode?: 'writable' | 'read_only';
	allowedPaths?: string[];
	ttlSeconds?: number;
}

export interface TreeDbWorkspace {
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

export interface TreeDbWorkspaceRequest {
	workspaceId: string;
}

export interface TreeDbListTreeRequest extends TreeDbWorkspaceRequest {
	path?: string;
	includeDeleted?: boolean;
}

export interface TreeDbTreeEntry {
	path: string;
	name: string;
	kind: 'blob' | 'tree';
	status?: string;
	source?: 'base' | 'overlay';
	objectId?: string | null;
	contentHash?: string | null;
}

export interface TreeDbReadFileRequest extends TreeDbWorkspaceRequest {
	path: string;
	allowProtected?: boolean;
}

export interface TreeDbFile {
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

export interface TreeDbWriteFileRequest extends TreeDbWorkspaceRequest {
	path: string;
	encoding?: 'utf8';
	content: string;
	expectedSha?: string;
	allowProtected?: boolean;
}

export interface TreeDbPatchFileRequest extends TreeDbWorkspaceRequest {
	path: string;
	patch: string;
	expectedSha?: string;
	allowProtected?: boolean;
}

export interface TreeDbDeleteFileRequest extends TreeDbWorkspaceRequest {
	path: string;
	expectedSha?: string;
	allowProtected?: boolean;
}

export interface TreeDbFileMutationResult {
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

export interface TreeDbBlobReadRequest {
	repoId?: string;
	ref?: string;
	path: string;
	encoding?: 'base64';
	expectedContentHash?: string;
	allowProtected?: boolean;
}

export interface TreeDbBlobWriteRequest extends TreeDbWorkspaceRequest {
	path: string;
	encoding?: 'base64';
	contentBase64: string;
	contentType?: string;
	expectedSha?: string;
	expectedContentHash?: string;
	allowProtected?: boolean;
}

export interface TreeDbBlobDeleteRequest extends TreeDbWorkspaceRequest {
	path: string;
	expectedSha?: string;
	allowProtected?: boolean;
}

export interface TreeDbBlobDownloadRequest extends TreeDbWorkspaceRequest {
	path: string;
	allowProtected?: boolean;
}

export interface TreeDbBlobUploadRequest extends TreeDbWorkspaceRequest {
	path: string;
	content: ArrayBuffer | Uint8Array | Blob;
	contentType?: string;
	expectedSha?: string;
	expectedContentHash?: string;
	allowProtected?: boolean;
}

export interface TreeDbBlob {
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

export interface TreeDbBlobMutationResult {
	workspaceId: string;
	path: string;
	op: 'put' | 'delete';
	encoding?: 'base64';
	contentHash?: string | null;
	byteLength?: number;
	contentType?: string | null;
}

export interface TreeDbBlobDownload {
	content: ArrayBuffer;
	contentType: string | null;
	contentHash?: string;
	objectId?: string;
	source?: 'base' | 'workspace';
}

export interface TreeDbSearchRequest extends TreeDbWorkspaceRequest {
	query: string;
	path?: string;
	limit?: number;
	caseSensitive?: boolean;
}

export interface TreeDbSearchResult {
	results: Array<{
		path: string;
		line: number;
		column: number;
		snippet: string;
		source: 'base' | 'overlay';
	}>;
	truncated?: boolean;
}

export interface TreeDbStatus {
	workspaceId: string;
	status: string;
	changes: Array<Record<string, unknown>>;
}

export interface TreeDbDiff {
	workspaceId: string;
	diff: string;
	changedPaths: string[];
}

export interface TreeDbCommitRequest extends TreeDbWorkspaceRequest {
	message: string;
	author: {
		name: string;
		email: string;
	};
	indexPolicy?: string;
}

export interface TreeDbCommitResult {
	repoId: string;
	workspaceId: string;
	branchName: string;
	commitSha: string;
	changedPaths: string[];
	status: 'committed';
}

export interface TreeDbExecRequest extends TreeDbWorkspaceRequest {
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

export interface TreeDbExecResult {
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

export interface TreeDbRepositoryReadRequest {
	repoId?: string;
	ref?: string;
	path?: string;
	paths?: string[];
	encoding?: 'utf8' | 'base64';
	parseFrontmatter?: boolean;
	allowProtected?: boolean;
}

export interface TreeDbRepositoryPathsRequest {
	repoId?: string;
	ref?: string;
	paths?: string[];
	kinds?: Array<'blob' | 'tree'>;
	extensions?: string[];
	limit?: number;
	cursor?: string | null;
	allowProtected?: boolean;
}

export interface TreeDbRepositorySearchRequest {
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

export interface TreeDbRepositoryQueryRequest {
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

export interface TreeDbRankingDiagnostics {
	level: 'none' | 'summary' | 'ranking';
	authorizedResultCount: number;
	returnedResultCount: number;
	searchedPatterns?: string[];
	scoreFactors?: unknown;
}

export interface TreeDbRepositoryQueryResult {
	repoId: string;
	ref: string;
	resolvedRef: string;
	query?: string;
	results?: unknown[];
	entries?: unknown[];
	file?: unknown;
	files?: unknown[];
	diagnostics?: TreeDbRankingDiagnostics;
	page?: {
		limit: number;
		nextCursor: string | null;
		hasMore: boolean;
	};
}

export interface TreeDbGraphRefreshRequest extends SdkGraphRefreshRequest {
	repoId?: string;
	ref?: string;
	allowProtected?: boolean;
	force?: boolean;
	incremental?: boolean;
	changedPaths?: string[];
	baseGraphVersion?: string;
	forceFull?: boolean;
}

export type TreeDbGraphRefreshResult = SdkGraphRefreshPayload & {
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

export interface TreeDbGraphRefreshJobRequest {
	repoId?: string;
	ref?: string;
	jobId: string;
}

export interface TreeDbGraphRefreshJob {
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

export type TreeDbContextMode = 'brief' | 'detailed' | 'citations' | 'mixed';

export interface TreeDbContextBudgetDiagnostics {
	requestedMaxNodes: number;
	usedNodes: number;
	requestedMaxTokens: number;
	estimatedTokens: number;
	truncated: boolean;
}

export interface TreeDbSearchIndexRefreshRequest {
	repoId?: string;
	ref?: string;
	paths?: string[];
	allowProtected?: boolean;
}

export interface TreeDbSearchIndexRefreshResult {
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

export interface TreeDbSearchIndexStatusRequest {
	repoId?: string;
	ref?: string;
}

export interface TreeDbSearchIndexStatus {
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

export interface TreeDbSearchIndexCompactRequest {
	repoId?: string;
	ref?: string;
	dryRun?: boolean;
}

export interface TreeDbSearchIndexCompactResult {
	repoId: string;
	ref: string;
	dryRun: boolean;
	segmentsBefore: number;
	segmentsAfter: number;
	compacted: boolean;
}

export interface TreeDbGraphSearchRequest {
	repoId?: string;
	ref?: string;
	query: string;
	limit?: number;
	options?: SdkGraphSearchOptions;
}

export interface TreeDbGraphNodeRequest {
	repoId?: string;
	ref?: string;
	nodeId: string;
}

export interface TreeDbGraphRelatedRequest {
	repoId?: string;
	ref?: string;
	nodeId: string;
	relations?: string[];
	options?: Record<string, unknown>;
}

export interface TreeDbGraphSubgraphRequest {
	repoId?: string;
	ref?: string;
	seedIds: string[];
	options?: Record<string, unknown>;
}

export interface TreeDbGraphQueryRequest extends SdkGraphQueryRequest {
	repoId?: string;
	ref?: string;
}

export type TreeDbGraphQueryResult = SdkGraphQueryResult & {
	repoId: string;
	graphVersion: string;
};

export interface TreeDbContextRequest extends SdkContextPackRequest {
	repoId?: string;
	ref?: string;
	mode?: TreeDbContextMode;
}

export type TreeDbContextResult = SdkContextPack & {
	repoId: string;
	graphVersion: string;
	mode?: TreeDbContextMode;
	diagnostics?: {
		mode?: TreeDbContextMode;
		budget?: TreeDbContextBudgetDiagnostics;
		provenancePaths?: string[];
		[key: string]: unknown;
	};
};

export interface TreeDbCtxParseRequest {
	repoId?: string;
	ref?: string;
	source: string;
}

export type TreeDbCtxParseResult = SdkGraphDslParseResult;

export interface TreeDbFederatedScopeInput {
	repoIds?: string[];
	refs?: Record<string, string>;
	paths?: Record<string, string[]>;
	includeErrors?: boolean;
	timeoutMs?: number;
	limit?: number;
	cursor?: string | null;
}

export interface TreeDbFederatedError {
	repoId?: string;
	nodeId?: string;
	code: string;
	message: string;
	status?: number;
}

export interface TreeDbFederatedDiagnostics {
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

export interface TreeDbFederatedSearchRequest extends TreeDbFederatedScopeInput {
	repoId?: string;
	query: string;
	filters?: unknown[];
	sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;
}

export interface TreeDbFederatedSearchResult {
	query: string;
	results: Array<Record<string, unknown> & { repoId: string; ref: string; source: 'local' | 'remote' }>;
	page: { limit: number; hasMore: boolean; cursor?: string | null };
	diagnostics: TreeDbFederatedDiagnostics;
	errors?: TreeDbFederatedError[];
}

export interface TreeDbFederatedQueryRequest extends TreeDbFederatedScopeInput {
	repoId?: string;
	type: 'path' | 'text' | 'frontmatter' | 'section' | 'link' | 'changed_path' | 'combined';
	query?: string;
	filters?: unknown[];
	sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;
}

export interface TreeDbFederatedQueryResult {
	type: string;
	results: Array<Record<string, unknown> & { repoId: string; ref: string; source: 'local' | 'remote' }>;
	page: { limit: number; hasMore: boolean; cursor?: string | null };
	diagnostics: TreeDbFederatedDiagnostics;
	errors?: TreeDbFederatedError[];
}

export interface TreeDbFederatedContextRequest extends TreeDbFederatedScopeInput {
	query?: string;
	seedIds?: string[];
	seeds?: unknown[];
	relations?: unknown[];
	scopePaths?: string[];
	budget?: Record<string, unknown>;
}

export interface TreeDbFederatedContextResult {
	nodes: unknown[];
	edges: unknown[];
	files?: unknown[];
	sections?: unknown[];
	diagnostics: TreeDbFederatedDiagnostics & Record<string, unknown>;
	errors?: TreeDbFederatedError[];
}

export interface TreeDbFederatedGraphRequest extends TreeDbFederatedScopeInput {
	query?: string;
	seedIds?: string[];
	seeds?: unknown[];
	relations?: unknown[];
	scopePaths?: string[];
	options?: Record<string, unknown>;
}

export interface TreeDbFederatedGraphResult {
	nodes: unknown[];
	edges: unknown[];
	diagnostics: TreeDbFederatedDiagnostics & { crossRepoEdgeCount?: number };
	errors?: TreeDbFederatedError[];
}

export type TreeDbSnapshotKind =
	| 'repository_snapshot'
	| 'index_snapshot'
	| 'graph_snapshot'
	| 'search_snapshot'
	| 'audit_export';

export interface TreeDbSnapshotFile {
	path: string;
	objectId: string;
	size: number;
	contentHash: string;
}

export interface TreeDbArtifact {
	artifactId: string;
	snapshotId: string;
	repoId: string;
	format: 'tar.zst';
	size: number;
	checksum: string;
	uri: string;
	downloadUrl?: string;
	createdAt?: string;
}

export interface TreeDbSnapshot {
	snapshotId: string;
	repoId: string;
	ref: string;
	commitSha: string;
	kind: TreeDbSnapshotKind;
	includedPaths: string[];
	graphVersion?: string | null;
	fileCount: number;
	totalBytes: number;
	files?: TreeDbSnapshotFile[];
	checksums: Record<string, unknown>;
	artifact?: TreeDbArtifact | null;
	createdAt: string;
}

export interface TreeDbSnapshotBuildRequest {
	repoId?: string;
	ref?: string;
	kind?: TreeDbSnapshotKind;
	paths?: string[];
	allowProtected?: boolean;
	includeGraph?: boolean;
}

export interface TreeDbArtifactExportRequest extends TreeDbSnapshotBuildRequest {
	snapshotId?: string;
}

export interface TreeDbArtifactDownload {
	content: ArrayBuffer;
	contentType: string | null;
	filename?: string;
	checksum?: string;
	snapshotId?: string;
}

export interface TreeDbMirrorSyncRequest {
	repoId?: string;
	mirrorId: string;
	remoteName?: string;
	remoteUrl?: string;
	refspecs?: string[];
	dryRun?: boolean;
}

export interface TreeDbMirrorSyncResult {
	mirror: TreeDbMirror;
	sync: Record<string, unknown>;
}

export interface TreeDbFetchRemoteRequest {
	repoId?: string;
	remoteName?: string;
	remoteUrl?: string;
	refspecs?: string[];
	dryRun?: boolean;
}

export interface TreeDbFetchRemoteResult {
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

export interface TreeDbPushRequest extends TreeDbFetchRemoteRequest {
	refspecs: string[];
	expectedRemoteHead?: string | null;
}

export interface TreeDbPushResult {
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

export interface TreeDbMirrorHealthRequest {
	repoId?: string;
	mirrorId: string;
}

export interface TreeDbMirrorHealthResult {
	health: {
		mirrorId: string;
		repoId: string;
		status: 'healthy' | 'degraded' | 'unhealthy' | string;
		mirrorStatus?: string;
		behindBy?: number | null;
		lastSeenCommit?: string | null;
	};
}

export interface TreeDbMirrorPromotionRequest {
	repoId?: string;
	mirrorId: string;
	dryRun?: boolean;
	requireSynced?: boolean;
}

export interface TreeDbMirrorPromotionResult {
	promotion: {
		mirrorId: string;
		repoId: string;
		dryRun: boolean;
		status: 'planned' | 'promoted' | string;
		previousPlacement?: TreeDbRepositoryPlacement | null;
		resultingPlacement?: TreeDbRepositoryPlacement | null;
	};
}

export interface TreeDbStorageCompactRequest {
	logs?: string[];
	dryRun?: boolean;
	backupBefore?: boolean;
}

export interface TreeDbStorageCompactResult {
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

export interface TreeDbStorageBackupRequest {
	include?: string[];
	verify?: boolean;
}

export interface TreeDbStorageBackupResult {
	backup: {
		backupId: string;
		format: 'tar.zst';
		uri: string;
		checksum: string;
		byteLength: number;
		verified: boolean;
	};
}

export interface TreeDbMigrationRequest {
	repoId?: string;
	targetNodeId: string;
	sourceNodeId?: string;
	mode?: 'primary_transfer' | 'mirror_promotion';
	dryRun?: boolean;
	requireMirrorSynced?: boolean;
}

export interface TreeDbMigration {
	id: string;
	repositoryId: string;
	sourceNodeId: string;
	targetNodeId: string;
	mode: string;
	status: string;
	dryRun: boolean;
	requireMirrorSynced: boolean;
	previousPlacement?: TreeDbRepositoryPlacement | null;
	resultingPlacement?: TreeDbRepositoryPlacement | null;
	createdAt: string;
	completedAt?: string | null;
}

export type {
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
