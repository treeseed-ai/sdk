import type { TreeDbClient } from './client.ts';
import type { TreeDbFederatedClient } from './federated-client.ts';
import type { TreeDbGraphAdapter } from './graph-adapter.ts';
import type { TreeDbQueryAdapter } from './query-adapter.ts';
import type { TreeDbRegistryClient } from './registry-client.ts';
import type { TreeDbRepositoryAdapter } from './repository-adapter.ts';
import type { TreeDbWorkspaceAdapter } from './workspace-adapter.ts';
import type { ContentStore } from '../content-store.ts';
import type { ContentGraphRuntime } from '../graph.ts';
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
} from '../sdk-types.ts';
import type {
	TreeDbArtifact,
	TreeDbArtifactDownload,
	TreeDbArtifactExportRequest,
	TreeDbCommitRequest,
	TreeDbCommitResult,
	TreeDbCreateWorkspaceRequest,
	TreeDbDiff,
	TreeDbExecRequest,
	TreeDbExecResult,
	TreeDbFederatedContextRequest,
	TreeDbFederatedContextResult,
	TreeDbFederatedGraphRequest,
	TreeDbFederatedGraphResult,
	TreeDbFederatedQueryRequest,
	TreeDbFederatedQueryResult,
	TreeDbFederatedSearchRequest,
	TreeDbFederatedSearchResult,
	TreeDbFile,
	TreeDbFileMutationResult,
	TreeDbListTreeRequest,
	TreeDbPatchFileRequest,
	TreeDbReadFileRequest,
	TreeDbRepositoryPathsRequest,
	TreeDbRepositoryPlacement,
	TreeDbRepositoryQueryRequest,
	TreeDbRepositoryQueryResult,
	TreeDbRepositoryReadRequest,
	TreeDbRepositorySearchRequest,
	TreeDbSearchRequest,
	TreeDbSearchResult,
	TreeDbSnapshot,
	TreeDbSnapshotBuildRequest,
	TreeDbStatus,
	TreeDbTreeEntry,
	TreeDbWorkspace,
	TreeDbWorkspaceRequest,
	TreeDbWriteFileRequest,
	TreeDbDeleteFileRequest,
} from './types.ts';

export interface AuthPort {
	whoami(): Promise<unknown>;
	effectiveScope(input?: unknown): Promise<unknown>;
}

export interface RepositoryPort {
	createWorkspace(input: TreeDbCreateWorkspaceRequest): Promise<TreeDbWorkspace>;
	closeWorkspace(workspaceId: string): Promise<void>;
	listTree(input: TreeDbListTreeRequest): Promise<TreeDbTreeEntry[]>;
	readFile(input: TreeDbReadFileRequest): Promise<TreeDbFile>;
	writeFile(input: TreeDbWriteFileRequest): Promise<TreeDbFileMutationResult>;
	patchFile(input: TreeDbPatchFileRequest): Promise<TreeDbFileMutationResult>;
	deleteFile(input: TreeDbDeleteFileRequest): Promise<TreeDbFileMutationResult>;
	search(input: TreeDbSearchRequest): Promise<TreeDbSearchResult>;
	status(input: TreeDbWorkspaceRequest): Promise<TreeDbStatus>;
	diff(input: TreeDbWorkspaceRequest): Promise<TreeDbDiff>;
	commit(input: TreeDbCommitRequest): Promise<TreeDbCommitResult>;
	exec(input: TreeDbExecRequest): Promise<TreeDbExecResult>;
}

export interface RepositoryQueryPort {
	read(input: TreeDbRepositoryReadRequest): Promise<TreeDbRepositoryQueryResult>;
	paths(input: TreeDbRepositoryPathsRequest): Promise<TreeDbRepositoryQueryResult>;
	query(input: TreeDbRepositoryQueryRequest): Promise<TreeDbRepositoryQueryResult>;
	search(input: TreeDbRepositorySearchRequest): Promise<TreeDbRepositoryQueryResult>;
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
	exec(input: TreeDbExecRequest): Promise<TreeDbExecResult>;
}

export interface ArtifactPort {
	buildSnapshot(input?: TreeDbSnapshotBuildRequest): Promise<TreeDbSnapshot>;
	exportArtifact(input?: TreeDbArtifactExportRequest): Promise<TreeDbArtifact>;
	downloadArtifact(input?: TreeDbArtifactExportRequest): Promise<TreeDbArtifactDownload>;
}

export interface FederatedPort {
	search(input: TreeDbFederatedSearchRequest): Promise<TreeDbFederatedSearchResult>;
	query(input: TreeDbFederatedQueryRequest): Promise<TreeDbFederatedQueryResult>;
	context(input: TreeDbFederatedContextRequest): Promise<TreeDbFederatedContextResult>;
	graph(input: TreeDbFederatedGraphRequest): Promise<TreeDbFederatedGraphResult>;
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

export class TreeDbRepositoryPort implements RepositoryPort {
	constructor(
		readonly client: TreeDbClient,
		readonly content?: TreeDbRepositoryAdapter,
		readonly workspace?: TreeDbWorkspaceAdapter,
	) {}

	createWorkspace(input: TreeDbCreateWorkspaceRequest) {
		return this.client.createWorkspace(input);
	}

	closeWorkspace(workspaceId: string) {
		return this.client.closeWorkspace(workspaceId);
	}

	listTree(input: TreeDbListTreeRequest) {
		return this.client.listTree(input);
	}

	readFile(input: TreeDbReadFileRequest) {
		return this.client.readFile(input);
	}

	writeFile(input: TreeDbWriteFileRequest) {
		return this.client.writeFile(input);
	}

	patchFile(input: TreeDbPatchFileRequest) {
		return this.client.patchFile(input);
	}

	deleteFile(input: TreeDbDeleteFileRequest) {
		return this.client.deleteFile(input);
	}

	search(input: TreeDbSearchRequest) {
		return this.client.search(input);
	}

	status(input: TreeDbWorkspaceRequest) {
		return this.client.status(input);
	}

	diff(input: TreeDbWorkspaceRequest) {
		return this.client.diff(input);
	}

	commit(input: TreeDbCommitRequest) {
		return this.client.commit(input);
	}

	exec(input: TreeDbExecRequest) {
		return this.client.exec(input);
	}
}

export class TreeDbRepositoryQueryPort implements RepositoryQueryPort {
	constructor(readonly client: TreeDbClient, readonly adapter?: TreeDbQueryAdapter) {}

	read(input: TreeDbRepositoryReadRequest) {
		return this.client.readRepositoryFiles(input);
	}

	paths(input: TreeDbRepositoryPathsRequest) {
		return this.client.listRepositoryPaths(input);
	}

	query(input: TreeDbRepositoryQueryRequest) {
		return this.adapter?.queryRepository(input) ?? this.client.queryRepository(input);
	}

	search(input: TreeDbRepositorySearchRequest) {
		return this.client.searchRepositoryFiles(input);
	}
}

export class TreeDbGraphPort implements GraphPort {
	constructor(readonly adapter: TreeDbGraphAdapter) {}

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

export class TreeDbRegistryPort implements RegistryPort {
	constructor(readonly client: TreeDbRegistryClient) {}

	resolveRepository(repoId: string): Promise<TreeDbRepositoryPlacement> {
		return this.client.resolveRepository(repoId);
	}

	resolveRepositories(repoIds: string[]): Promise<TreeDbRepositoryPlacement[]> {
		return this.client.resolveRepositories(repoIds);
	}
}

export class TreeDbFederatedPort implements FederatedPort {
	constructor(readonly client: TreeDbFederatedClient) {}

	search(input: TreeDbFederatedSearchRequest) {
		return this.client.federatedSearch(input);
	}

	query(input: TreeDbFederatedQueryRequest) {
		return this.client.federatedQuery(input);
	}

	context(input: TreeDbFederatedContextRequest) {
		return this.client.federatedContext(input);
	}

	graph(input: TreeDbFederatedGraphRequest) {
		return this.client.federatedGraph(input);
	}
}

export class TreeDbExecPort implements ExecPort {
	constructor(readonly client: TreeDbClient) {}

	exec(input: TreeDbExecRequest) {
		return this.client.exec(input);
	}
}

export class TreeDbArtifactPort implements ArtifactPort {
	constructor(readonly client: TreeDbClient) {}

	buildSnapshot(input: TreeDbSnapshotBuildRequest = {}) {
		return this.client.buildSnapshot(input);
	}

	exportArtifact(input: TreeDbArtifactExportRequest = {}) {
		return this.client.exportArtifact(input);
	}

	downloadArtifact(input: TreeDbArtifactExportRequest = {}) {
		return this.client.downloadArtifact(input);
	}
}
