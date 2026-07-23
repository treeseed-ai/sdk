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
	planOnly?: boolean;
}

export interface TreeDxSearchIndexCompactResult {
	repoId: string;
	ref: string;
	planOnly: boolean;
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
