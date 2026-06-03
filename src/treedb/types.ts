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
}

export interface TreeDbExecResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	elapsedMs: number;
	truncated: boolean;
	changedPaths: string[];
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
}

export type TreeDbGraphRefreshResult = SdkGraphRefreshPayload & {
	repoId: string;
	ref: string;
	resolvedRef: string;
	graphVersion: string;
};

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
}

export type TreeDbContextResult = SdkContextPack & {
	repoId: string;
	graphVersion: string;
};

export interface TreeDbCtxParseRequest {
	repoId?: string;
	ref?: string;
	source: string;
}

export type TreeDbCtxParseResult = SdkGraphDslParseResult;

export interface TreeDbFederatedQueryRequest extends TreeDbRepositoryQueryRequest {
	repoIds?: string[];
	includeErrors?: boolean;
}

export interface TreeDbFederatedQueryResult {
	results: Array<{ repoId: string; result: TreeDbRepositoryQueryResult }>;
	errors?: Array<{ repoId: string; error: { code: string; message: string; status: number } }>;
}

export interface TreeDbFederatedSearchRequest extends TreeDbRepositorySearchRequest {
	repoIds?: string[];
	includeErrors?: boolean;
}

export interface TreeDbFederatedSearchResult {
	results: Array<{ repoId: string; result: TreeDbRepositoryQueryResult }>;
	errors?: Array<{ repoId: string; error: { code: string; message: string; status: number } }>;
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
