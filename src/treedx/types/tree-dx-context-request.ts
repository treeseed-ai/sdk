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
import { TreeDxContextBudgetDiagnostics, TreeDxContextMode } from './tree-dx-exec-result.ts';
import { TreeDxMirror } from './tree-dx-actor.ts';

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
	planOnly?: boolean;
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
	planOnly?: boolean;
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
