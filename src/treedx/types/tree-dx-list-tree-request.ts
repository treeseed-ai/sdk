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
import { TreeDxWorkspaceRequest } from './tree-dx-actor.ts';

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
