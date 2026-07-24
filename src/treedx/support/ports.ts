import type { TreeDxClient } from './client.ts';
import type { TreeDxFederatedClient } from '../federation/federated-client.ts';
import type { TreeDxGraphAdapter } from '../graph/graph-adapter.ts';
import type { TreeDxQueryAdapter } from '../reconciliation/query-adapter.ts';
import type { TreeDxRegistryClient } from './registry-client.ts';
import type { TreeDxRepositoryAdapter } from '../reconciliation/repository-adapter.ts';
import type { TreeDxWorkspaceAdapter } from '../workspaces/workspace-adapter.ts';
import type { ContentStore } from '../../content/content-store.ts';
import type { ContentGraphRuntime } from '../graph/graph.ts';
import type {
	SdkContentEntry,
	SdkContextPackRequest,
	SdkFollowRequest,
	SdkGetRequest,
	SdkGraphQueryRequest,
	SdkGraphSearchOptions,
	SdkMutationRequest,
	SdkPickRequest,
	SdkSearchRequest,
} from '../../entrypoints/models/sdk-types.ts';
import type {
	TreeDxArtifact,
	TreeDxArtifactDownload,
	TreeDxArtifactExportRequest,
	TreeDxCommitRequest,
	TreeDxCommitResult,
	TreeDxCreateWorkspaceRequest,
	TreeDxDiff,
	TreeDxExecRequest,
	TreeDxExecResult,
	TreeDxFederatedContextRequest,
	TreeDxFederatedContextResult,
	TreeDxFederatedGraphRequest,
	TreeDxFederatedGraphResult,
	TreeDxFederatedQueryRequest,
	TreeDxFederatedQueryResult,
	TreeDxFederatedSearchRequest,
	TreeDxFederatedSearchResult,
	TreeDxFile,
	TreeDxFileMutationResult,
	TreeDxListTreeRequest,
	TreeDxPatchFileRequest,
	TreeDxReadFileRequest,
	TreeDxRepositoryPathsRequest,
	TreeDxRepositoryPlacement,
	TreeDxRepositoryQueryRequest,
	TreeDxRepositoryQueryResult,
	TreeDxRepositoryReadRequest,
	TreeDxRepositorySearchRequest,
	TreeDxSearchRequest,
	TreeDxSearchResult,
	TreeDxSnapshot,
	TreeDxSnapshotBuildRequest,
	TreeDxStatus,
	TreeDxTreeEntry,
	TreeDxWorkspace,
	TreeDxWorkspaceRequest,
	TreeDxWriteFileRequest,
	TreeDxDeleteFileRequest,
} from '../types.ts';

export interface AuthPort {
	whoami(): Promise<unknown>;
	effectiveScope(input?: unknown): Promise<unknown>;
}

export interface RepositoryPort {
	createWorkspace(input: TreeDxCreateWorkspaceRequest): Promise<TreeDxWorkspace>;
	closeWorkspace(workspaceId: string): Promise<void>;
	listTree(input: TreeDxListTreeRequest): Promise<TreeDxTreeEntry[]>;
	readFile(input: TreeDxReadFileRequest): Promise<TreeDxFile>;
	writeFile(input: TreeDxWriteFileRequest): Promise<TreeDxFileMutationResult>;
	patchFile(input: TreeDxPatchFileRequest): Promise<TreeDxFileMutationResult>;
	deleteFile(input: TreeDxDeleteFileRequest): Promise<TreeDxFileMutationResult>;
	search(input: TreeDxSearchRequest): Promise<TreeDxSearchResult>;
	status(input: TreeDxWorkspaceRequest): Promise<TreeDxStatus>;
	diff(input: TreeDxWorkspaceRequest): Promise<TreeDxDiff>;
	commit(input: TreeDxCommitRequest): Promise<TreeDxCommitResult>;
	exec(input: TreeDxExecRequest): Promise<TreeDxExecResult>;
}

export interface RepositoryQueryPort {
	read(input: TreeDxRepositoryReadRequest): Promise<TreeDxRepositoryQueryResult>;
	paths(input: TreeDxRepositoryPathsRequest): Promise<TreeDxRepositoryQueryResult>;
	query(input: TreeDxRepositoryQueryRequest): Promise<TreeDxRepositoryQueryResult>;
	search(input: TreeDxRepositorySearchRequest): Promise<TreeDxRepositoryQueryResult>;
}

export interface GraphPort {
	refresh(input?: unknown): Promise<unknown>;
	searchFiles(query: string, options?: unknown): Promise<unknown>;
	searchSections(query: string, options?: unknown): Promise<unknown>;
	searchEntities(query: string, options?: unknown): Promise<unknown>;
	getNode(id: string, options?: unknown): Promise<unknown>;
	query(input: unknown): Promise<unknown>;
	buildContext(input: unknown): Promise<unknown>;
	parseDsl(source: string): Promise<unknown>;
}

export interface RegistryPort {
	resolveRepository(repoId: string): Promise<unknown>;
	resolveRepositories(repoIds: string[]): Promise<unknown[]>;
}

export interface ExecPort {
	exec(input: TreeDxExecRequest): Promise<TreeDxExecResult>;
}

export interface ArtifactPort {
	buildSnapshot(input?: TreeDxSnapshotBuildRequest): Promise<TreeDxSnapshot>;
	exportArtifact(input?: TreeDxArtifactExportRequest): Promise<TreeDxArtifact>;
	downloadArtifact(input?: TreeDxArtifactExportRequest): Promise<TreeDxArtifactDownload>;
}

export interface FederatedPort {
	search(input: TreeDxFederatedSearchRequest): Promise<TreeDxFederatedSearchResult>;
	query(input: TreeDxFederatedQueryRequest): Promise<TreeDxFederatedQueryResult>;
	context(input: TreeDxFederatedContextRequest): Promise<TreeDxFederatedContextResult>;
	graph(input: TreeDxFederatedGraphRequest): Promise<TreeDxFederatedGraphResult>;
}

export class LocalRepositoryPort {
	constructor(readonly content: ContentStore) {}

	list(model: string): Promise<SdkContentEntry[]> {
		return this.content.list(model);
	}

	get(input: SdkGetRequest): Promise<SdkContentEntry | null> {
		return this.content.get(input);
	}

	search(input: SdkSearchRequest): Promise<SdkContentEntry[]> {
		return this.content.search(input);
	}

	follow(input: SdkFollowRequest) {
		return this.content.follow(input);
	}

	pick(input: SdkPickRequest) {
		return this.content.pick(input);
	}

	create(input: SdkMutationRequest) {
		return this.content.create(input);
	}

	update(input: SdkMutationRequest) {
		return this.content.update(input);
	}
}

export class LocalRepositoryQueryPort {
	constructor(readonly content: ContentStore) {}

	search(input: SdkSearchRequest): Promise<SdkContentEntry[]> {
		return this.content.search(input);
	}

	query(input: SdkSearchRequest): Promise<SdkContentEntry[]> {
		return this.content.search(input);
	}
}

export class LocalGraphPort implements GraphPort {
	constructor(readonly runtime: ContentGraphRuntime) {}

	refresh(input?: unknown) {
		return this.runtime.refresh(input as never);
	}

	searchFiles(query: string, options?: unknown) {
		return this.runtime.searchFiles(query, options as SdkGraphSearchOptions);
	}

	searchSections(query: string, options?: unknown) {
		return this.runtime.searchSections(query, options as SdkGraphSearchOptions);
	}

	searchEntities(query: string, options?: unknown) {
		return this.runtime.searchEntities(query, options as SdkGraphSearchOptions);
	}

	getNode(id: string) {
		return this.runtime.getNode(id);
	}

	query(input: unknown) {
		return this.runtime.queryGraph(input as SdkGraphQueryRequest);
	}

	buildContext(input: unknown) {
		return this.runtime.buildContextPack(input as SdkContextPackRequest);
	}

	parseDsl(source: string) {
		return this.runtime.parseGraphDsl(source);
	}
}

export class TreeDxRepositoryPort implements RepositoryPort {
	constructor(
		readonly client: TreeDxClient,
		readonly content?: TreeDxRepositoryAdapter,
		readonly workspace?: TreeDxWorkspaceAdapter,
	) {}

	createWorkspace(input: TreeDxCreateWorkspaceRequest) {
		return this.client.createWorkspace(input);
	}

	closeWorkspace(workspaceId: string) {
		return this.client.closeWorkspace(workspaceId);
	}

	listTree(input: TreeDxListTreeRequest) {
		return this.client.listTree(input);
	}

	readFile(input: TreeDxReadFileRequest) {
		return this.client.readFile(input);
	}

	writeFile(input: TreeDxWriteFileRequest) {
		return this.client.writeFile(input);
	}

	patchFile(input: TreeDxPatchFileRequest) {
		return this.client.patchFile(input);
	}

	deleteFile(input: TreeDxDeleteFileRequest) {
		return this.client.deleteFile(input);
	}

	search(input: TreeDxSearchRequest) {
		return this.client.search(input);
	}

	status(input: TreeDxWorkspaceRequest) {
		return this.client.status(input);
	}

	diff(input: TreeDxWorkspaceRequest) {
		return this.client.diff(input);
	}

	commit(input: TreeDxCommitRequest) {
		return this.client.commit(input);
	}

	exec(input: TreeDxExecRequest) {
		return this.client.exec(input);
	}
}

export class TreeDxRepositoryQueryPort implements RepositoryQueryPort {
	constructor(readonly client: TreeDxClient, readonly adapter?: TreeDxQueryAdapter) {}

	read(input: TreeDxRepositoryReadRequest) {
		return this.client.readRepositoryFiles(input);
	}

	paths(input: TreeDxRepositoryPathsRequest) {
		return this.client.listRepositoryPaths(input);
	}

	query(input: TreeDxRepositoryQueryRequest) {
		return this.adapter?.queryRepository(input) ?? this.client.queryRepository(input);
	}

	search(input: TreeDxRepositorySearchRequest) {
		return this.client.searchRepositoryFiles(input);
	}
}

export class TreeDxGraphPort implements GraphPort {
	constructor(readonly adapter: TreeDxGraphAdapter) {}

	refresh(input?: unknown) {
		return this.adapter.refresh(input as never);
	}

	searchFiles(query: string, options?: unknown) {
		return this.adapter.searchFiles(query, options as never);
	}

	searchSections(query: string, options?: unknown) {
		return this.adapter.searchSections(query, options as never);
	}

	searchEntities(query: string, options?: unknown) {
		return this.adapter.searchEntities(query, options as never);
	}

	getNode(id: string, options?: unknown) {
		return this.adapter.getNode(id, options as never);
	}

	query(input: unknown) {
		return this.adapter.queryGraph(input as never);
	}

	buildContext(input: unknown) {
		return this.adapter.buildContextPack(input as never);
	}

	parseDsl(source: string) {
		return this.adapter.parseGraphDsl(source);
	}
}

export class TreeDxRegistryPort implements RegistryPort {
	constructor(readonly client: TreeDxRegistryClient) {}

	resolveRepository(repoId: string): Promise<TreeDxRepositoryPlacement> {
		return this.client.resolveRepository(repoId);
	}

	resolveRepositories(repoIds: string[]): Promise<TreeDxRepositoryPlacement[]> {
		return this.client.resolveRepositories(repoIds);
	}
}

export class TreeDxFederatedPort implements FederatedPort {
	constructor(readonly client: TreeDxFederatedClient) {}

	search(input: TreeDxFederatedSearchRequest) {
		return this.client.federatedSearch(input);
	}

	query(input: TreeDxFederatedQueryRequest) {
		return this.client.federatedQuery(input);
	}

	context(input: TreeDxFederatedContextRequest) {
		return this.client.federatedContext(input);
	}

	graph(input: TreeDxFederatedGraphRequest) {
		return this.client.federatedGraph(input);
	}
}

export class TreeDxExecPort implements ExecPort {
	constructor(readonly client: TreeDxClient) {}

	exec(input: TreeDxExecRequest) {
		return this.client.exec(input);
	}
}

export class TreeDxArtifactPort implements ArtifactPort {
	constructor(readonly client: TreeDxClient) {}

	buildSnapshot(input: TreeDxSnapshotBuildRequest = {}) {
		return this.client.buildSnapshot(input);
	}

	exportArtifact(input: TreeDxArtifactExportRequest = {}) {
		return this.client.exportArtifact(input);
	}

	downloadArtifact(input: TreeDxArtifactExportRequest = {}) {
		return this.client.downloadArtifact(input);
	}
}
