import type { AgentPermissionConfig, AgentRuntimeSpec } from '../../types/agents.ts';
import { resolveSdkRepoRoot } from '../../runtime/runtime.ts';
import { normalizeAgentCliOptions } from '../../agents/cli-tools.ts';
import { ContentStore } from '../../content/content-store.ts';
import { CloudflareD1AgentDatabase, MemoryAgentDatabase, type AgentDatabase } from '../../persistence/d1-store.ts';
import { ContentGraphRuntime } from '../../treedx/graph/graph.ts';
import { createTreeDxClientFromAgentOptions, LocalContentBackend, LocalGraphBackend, MissingTreeDxContentBackend, resolveTreeDxOptions, TreeDxContentBackend, TreeDxGraphBackend, TreeDxPortfolioResolver, type AgentSdkContentRepositoryOptions, type AgentSdkTreeDxOptions, type ContentBackend, type GraphBackend, } from '../../treedx/repositories/treedx-backends.ts';
import { LocalGraphPort, LocalRepositoryPort, LocalRepositoryQueryPort, TreeDxArtifactPort, TreeDxExecPort, TreeDxFederatedClient, TreeDxFederatedPort, TreeDxGraphAdapter, TreeDxGraphPort, TreeDxRegistryClient, TreeDxRegistryPort, TreeDxRepositoryPort, TreeDxRepositoryQueryPort, TreeDxClient as PublicTreeDxClient, type TreeDxClientOptions as PublicTreeDxClientOptions, } from '../../treedx/index.ts';
import { loadPlugins, type LoadedPluginRegistration } from '../../platform/support/plugins.ts';
import { buildScopedModelRegistry, resolveModelDefinition } from './model-registry.ts';
import { findDispatchCapability } from '../dispatch/dispatch.ts';
import { RemoteClient, RemoteDispatchClient } from '../clients/remote.ts';
import { executeSdkOperation } from './sdk-dispatch.ts';
import { OperationsSdk } from '../../operations/runtime/runtime.ts';
import type { ReleaseDetail, ReleaseSummary, SharePackageStatus, WorkstreamDetail, WorkstreamEvent, WorkstreamSummary, } from '../../projects/projects-core/project-workflow.ts';
import type { SdkAckMessageRequest, SdkClaimMessageRequest, CreateApprovalRequestRequest, SdkCreateMessageRequest, SdkCursorRequest, SdkFollowRequest, SdkGetRequest, SdkGetCursorRequest, SdkJsonEnvelope, SdkLeaseReleaseRequest, SdkMutationRequest, SdkGraphQueryOptions, SdkGraphQueryRequest, SdkGraphRefreshRequest, SdkGraphSearchOptions, SdkContextPackRequest, SdkGraphDslParseResult, SdkPickRequest, SdkRecordRunRequest, SdkSearchRequest, SdkUpdateRequest, SdkModelDefinition, SdkModelRegistry, SdkGraphRankingProvider, SdkDispatchConfig, SdkDispatchRequest, SdkDispatchResult, SdkDispatchCredentialSource, DecideApprovalRequestRequest, ListApprovalRequestsRequest, UpsertTeamInboxItemRequest, } from './sdk-types.ts';
import { NodeSqliteD1Database } from '../../db/node-sqlite.ts';
export interface AgentSdkOptions {
    repoRoot?: string;
    database?: AgentDatabase;
    models?: SdkModelDefinition[];
    modelRegistry?: SdkModelRegistry;
    graphRankingProvider?: SdkGraphRankingProvider;
    plugins?: LoadedPluginRegistration[];
    dispatch?: SdkDispatchConfig;
    treeDx?: AgentSdkTreeDxOptions;
    contentRepository?: AgentSdkContentRepositoryOptions;
}
export type { AgentSdkContentRepositoryOptions, AgentSdkTreeDxOptions, TreeDxContentPathRule, TreeDxRepositoryHint, } from '../../treedx/repositories/treedx-backends.ts';
export function normalizeAgentSpec(entry: Record<string, unknown> | null): AgentRuntimeSpec | null {
    if (!entry) {
        return null;
    }
    const frontmatter = (entry.frontmatter ?? {}) as Record<string, unknown>;
    return {
        ...(frontmatter as unknown as AgentRuntimeSpec),
        slug: String(frontmatter.slug ?? entry.slug ?? ''),
        cli: normalizeAgentCliOptions(frontmatter.cli),
    };
}
export function normalizeOperation(operation: string) {
    return operation === 'read' ? 'get' : operation;
}
export function operationAllowed(permissions: AgentPermissionConfig[], model: string, operation: string) {
    const normalizedOperation = normalizeOperation(operation);
    return permissions.some((permission) => permission.model === model
        && permission.operations.map(normalizeOperation).includes(normalizedOperation as AgentPermissionConfig['operations'][number]));
}
import * as extractedMethods from "../../sdk/methods.ts";
import "../../sdk/interface.ts";
export class AgentSdk {
    readonly repoRoot: string;
    readonly database: AgentDatabase;
    readonly content: ContentBackend;
    readonly models: SdkModelRegistry;
    readonly ports: {
        repository: LocalRepositoryPort | TreeDxRepositoryPort;
        query: LocalRepositoryQueryPort | TreeDxRepositoryQueryPort;
        graph: LocalGraphPort | TreeDxGraphPort;
        registry?: TreeDxRegistryPort;
        federated?: TreeDxFederatedPort;
        exec?: TreeDxExecPort;
        artifact?: TreeDxArtifactPort;
    };
    readonly treeDx?: {
        client: PublicTreeDxClient;
        graph: TreeDxGraphAdapter;
        registry?: TreeDxRegistryClient;
        federated?: TreeDxFederatedClient;
        exec?: TreeDxExecPort;
        artifact?: TreeDxArtifactPort;
    };
    readonly localContentStore: ContentStore;
    readonly localGraphRuntime: ContentGraphRuntime;
    readonly graph: GraphBackend;
    readonly dispatchConfig?: SdkDispatchConfig;
    constructor(options: AgentSdkOptions = {}) {
        const rawTreeDxOptions = options.treeDx as AgentSdkTreeDxOptions & {
            client?: PublicTreeDxClient | PublicTreeDxClientOptions;
            repoId?: string;
            registryRouting?: boolean;
        } | undefined;
        if (rawTreeDxOptions && !options.repoRoot && !options.models && !options.modelRegistry) {
            throw new Error('AgentSdk TreeDX mode requires explicit models or modelRegistry.');
        }
        const repoRoot = options.repoRoot
            ? resolveSdkRepoRoot(options.repoRoot)
            : rawTreeDxOptions
                ? process.cwd()
                : resolveSdkRepoRoot();
        this.repoRoot = repoRoot;
        this.models = options.modelRegistry ?? buildScopedModelRegistry(repoRoot, options.models);
        this.database = options.database ?? new MemoryAgentDatabase();
        this.localContentStore = new ContentStore(repoRoot, this.database, this.models);
        let plugins = options.plugins;
        if (!plugins) {
            try {
                plugins = loadPlugins();
            }
            catch {
                plugins = [];
            }
        }
        this.localGraphRuntime = new ContentGraphRuntime(repoRoot, this.models, {
            rankingProvider: options.graphRankingProvider,
            plugins,
        });
        const treeDxOptions = resolveTreeDxOptions(options.treeDx);
        if (options.contentRepository?.adapter === 'local') {
            this.content = new LocalContentBackend(this.localContentStore);
            this.graph = new LocalGraphBackend(this.localGraphRuntime);
            this.ports = {
                repository: new LocalRepositoryPort(this.localContentStore),
                query: new LocalRepositoryQueryPort(this.localContentStore),
                graph: new LocalGraphPort(this.localGraphRuntime),
            };
        }
        else if (treeDxOptions) {
            const publicClient = rawTreeDxOptions?.client instanceof PublicTreeDxClient
                ? rawTreeDxOptions.client
                : new PublicTreeDxClient({
                    baseUrl: treeDxOptions.baseUrl,
                    token: treeDxOptions.token,
                    repoId: treeDxOptions.repoId,
                    fetch: treeDxOptions.fetchImpl,
                });
            const publicFetch = (input: RequestInfo | URL, init?: RequestInit) => {
                const headers = init?.headers instanceof Headers
                    ? Object.fromEntries(init.headers.entries())
                    : init?.headers;
                return ((publicClient as unknown as {
                    fetchImpl?: typeof fetch;
                }).fetchImpl ?? fetch)(input, {
                    ...init,
                    headers,
                });
            };
            const client = createTreeDxClientFromAgentOptions({
                ...treeDxOptions,
                fetchImpl: treeDxOptions.fetchImpl ?? publicFetch,
            });
            const resolver = new TreeDxPortfolioResolver({
                client,
                repoId: treeDxOptions.repoId,
                ref: treeDxOptions.ref,
                repositoryHints: treeDxOptions.repositoryHints,
            });
            const publicGraph = new TreeDxGraphAdapter({
                client: publicClient,
                repoId: treeDxOptions.repoId,
                defaultRef: treeDxOptions.ref,
            });
            const publicRegistry = rawTreeDxOptions?.registryRouting
                ? new TreeDxRegistryClient(publicClient)
                : undefined;
            const publicFederated = publicRegistry
                ? new TreeDxFederatedClient({
                    registry: publicRegistry,
                    token: treeDxOptions.token,
                    fetch: treeDxOptions.fetchImpl,
                })
                : undefined;
            const publicExec = new TreeDxExecPort(publicClient);
            const publicArtifact = new TreeDxArtifactPort(publicClient);
            this.content = new TreeDxContentBackend({
                client,
                repoRoot,
                models: this.models,
                resolver,
                directRepoId: treeDxOptions.repoId,
                ref: treeDxOptions.ref,
                workspaceId: treeDxOptions.workspaceId,
                contentPathMap: treeDxOptions.contentPathMap,
                localLeaseStore: this.localContentStore,
            });
            this.graph = new TreeDxGraphBackend({
                client,
                resolver,
                localRuntime: this.localGraphRuntime,
                directRepoId: treeDxOptions.repoId,
                ref: treeDxOptions.ref,
            });
            this.treeDx = {
                client: publicClient,
                graph: publicGraph,
                registry: publicRegistry,
                federated: publicFederated,
                exec: publicExec,
                artifact: publicArtifact,
            };
            this.ports = {
                repository: new TreeDxRepositoryPort(publicClient),
                query: new TreeDxRepositoryQueryPort(publicClient),
                graph: new TreeDxGraphPort(publicGraph),
                registry: publicRegistry ? new TreeDxRegistryPort(publicRegistry) : undefined,
                federated: publicFederated ? new TreeDxFederatedPort(publicFederated) : undefined,
                exec: publicExec,
                artifact: publicArtifact,
            };
        }
        else if (rawTreeDxOptions?.client) {
            const publicClient = rawTreeDxOptions.client instanceof PublicTreeDxClient
                ? rawTreeDxOptions.client
                : new PublicTreeDxClient(rawTreeDxOptions.client);
            const publicGraph = new TreeDxGraphAdapter({
                client: publicClient,
                repoId: rawTreeDxOptions.repoId,
                defaultRef: rawTreeDxOptions.ref,
            });
            const publicExec = new TreeDxExecPort(publicClient);
            const publicArtifact = new TreeDxArtifactPort(publicClient);
            this.content = new MissingTreeDxContentBackend();
            this.graph = new LocalGraphBackend(this.localGraphRuntime);
            this.treeDx = {
                client: publicClient,
                graph: publicGraph,
                exec: publicExec,
                artifact: publicArtifact,
            };
            this.ports = {
                repository: new TreeDxRepositoryPort(publicClient),
                query: new TreeDxRepositoryQueryPort(publicClient),
                graph: new TreeDxGraphPort(publicGraph),
                exec: publicExec,
                artifact: publicArtifact,
            };
        }
        else {
            this.content = new MissingTreeDxContentBackend();
            this.graph = new LocalGraphBackend(this.localGraphRuntime);
            this.ports = {
                repository: new LocalRepositoryPort(this.localContentStore),
                query: new LocalRepositoryQueryPort(this.localContentStore),
                graph: new LocalGraphPort(this.localGraphRuntime),
            };
        }
        this.dispatchConfig = options.dispatch;
    }
    static createLocal(options: {
        repoRoot?: string;
        databaseName?: string;
        persistTo?: string;
        models?: SdkModelDefinition[];
        modelRegistry?: SdkModelRegistry;
        contentRepository?: AgentSdkContentRepositoryOptions;
        treeDx?: AgentSdkTreeDxOptions;
        dispatch?: SdkDispatchConfig;
    } = {}) {
        const repoRoot = resolveSdkRepoRoot(options.repoRoot);
        const d1 = new NodeSqliteD1Database(options.persistTo ?? options.databaseName ?? '.treeseed/generated/environments/local/site-data.sqlite');
        return new AgentSdk({
            repoRoot,
            database: new CloudflareD1AgentDatabase(d1),
            models: options.models,
            modelRegistry: options.modelRegistry,
            contentRepository: options.contentRepository,
            treeDx: options.treeDx,
            dispatch: options.dispatch,
        });
    }
}
extractedMethods.installAgentSdkMethods(AgentSdk.prototype);
/** Operational SDK wrapper that enforces agent permissions on top of AgentSdk. */
export class ScopedAgentSdk {
    constructor(private readonly base: AgentSdk, private readonly actor: string, private readonly permissions: AgentPermissionConfig[]) { }
    private assertAllowed(model: string, operation: string) {
        const normalized = resolveModelDefinition(model, this.base.models).name;
        if (!operationAllowed(this.permissions, normalized, operation)) {
            throw new Error(`Agent "${this.actor}" is not allowed to ${operation} ${normalized}.`);
        }
    }
    private allowedModelsFor(operation: string) {
        return this.permissions
            .filter((permission) => permission.operations.map(normalizeOperation).includes(normalizeOperation(operation) as AgentPermissionConfig['operations'][number]))
            .map((permission) => resolveModelDefinition(permission.model, this.base.models).name);
    }
    private async assertGraphNodeAllowed(id: string, operation: 'search' | 'follow' | 'get') {
        const node = await this.base.getGraphNode(id);
        if (!node?.sourceModel) {
            return node;
        }
        const allowedOps = operation === 'get' ? ['search', 'follow'] as const : [operation];
        const permitted = allowedOps.some((op) => this.allowedModelsFor(op).includes(node.sourceModel!));
        if (!permitted) {
            throw new Error(`Agent "${this.actor}" is not allowed to ${operation} graph node ${id}.`);
        }
        return node;
    }
    get(request: SdkGetRequest) {
        this.assertAllowed(request.model, 'get');
        return this.base.get(request);
    }
    read(request: SdkGetRequest) {
        this.assertAllowed(request.model, 'read');
        return this.base.read(request);
    }
    search(request: SdkSearchRequest) {
        this.assertAllowed(request.model, 'search');
        return this.base.search(request);
    }
    follow(request: SdkFollowRequest) {
        this.assertAllowed(request.model, 'follow');
        return this.base.follow(request);
    }
    pick(request: SdkPickRequest) {
        this.assertAllowed(request.model, 'pick');
        return this.base.pick(request);
    }
    create(request: Omit<SdkMutationRequest, 'actor'>) {
        this.assertAllowed(request.model, 'create');
        return this.base.create({
            ...request,
            actor: this.actor,
        });
    }
    update(request: Omit<SdkUpdateRequest, 'actor'>) {
        this.assertAllowed(request.model, 'update');
        return this.base.update({
            ...request,
            actor: this.actor,
        });
    }
    claimMessage(request: SdkClaimMessageRequest) {
        this.assertAllowed('message', 'pick');
        return this.base.claimMessage(request);
    }
    ackMessage(request: SdkAckMessageRequest) {
        this.assertAllowed('message', 'update');
        return this.base.ackMessage(request);
    }
    createMessage(request: Omit<SdkCreateMessageRequest, 'actor'>) {
        this.assertAllowed('message', 'create');
        return this.base.createMessage({
            ...request,
            actor: this.actor,
        });
    }
    recordRun(request: SdkRecordRunRequest) {
        return this.base.recordRun(request);
    }
    getCursor(request: SdkGetCursorRequest) {
        return this.base.getCursor(request);
    }
    upsertCursor(request: SdkCursorRequest) {
        return this.base.upsertCursor(request);
    }
    releaseLease(request: SdkLeaseReleaseRequest) {
        return this.base.releaseLease(request);
    }
    releaseAllLeases() {
        return this.base.releaseAllLeases();
    }
    refreshGraph(request?: SdkGraphRefreshRequest) {
        return this.base.refreshGraph(request);
    }
    /** Advanced lexical graph primitive for file nodes. Scoped to models the agent may search. */
    searchFiles(query: string, options?: SdkGraphSearchOptions) {
        const allowedModels = this.allowedModelsFor('search');
        return this.base.searchFiles(query, { ...options, models: options?.models?.filter((model) => allowedModels.includes(model)) ?? allowedModels });
    }
    /** Advanced lexical graph primitive for section nodes. Scoped to models the agent may search. */
    searchSections(query: string, options?: SdkGraphSearchOptions) {
        const allowedModels = this.allowedModelsFor('search');
        return this.base.searchSections(query, { ...options, models: options?.models?.filter((model) => allowedModels.includes(model)) ?? allowedModels });
    }
    /** Advanced lexical graph primitive for entity nodes. Scoped to models the agent may search. */
    searchEntities(query: string, options?: SdkGraphSearchOptions) {
        const allowedModels = this.allowedModelsFor('search');
        return this.base.searchEntities(query, { ...options, models: options?.models?.filter((model) => allowedModels.includes(model)) ?? allowedModels });
    }
    async getGraphNode(id: string) {
        return this.assertGraphNodeAllowed(id, 'get');
    }
    async getNeighbors(id: string, options?: SdkGraphQueryOptions) {
        await this.assertGraphNodeAllowed(id, 'follow');
        const allowedModels = this.allowedModelsFor('follow');
        return this.base.getNeighbors(id, { ...options, models: options?.models?.filter((model) => allowedModels.includes(model)) ?? allowedModels });
    }
    async followReferences(id: string, options?: SdkGraphQueryOptions) {
        await this.assertGraphNodeAllowed(id, 'follow');
        const allowedModels = this.allowedModelsFor('follow');
        return this.base.followReferences(id, { ...options, models: options?.models?.filter((model) => allowedModels.includes(model)) ?? allowedModels });
    }
    async getBacklinks(id: string, options?: SdkGraphQueryOptions) {
        await this.assertGraphNodeAllowed(id, 'follow');
        const allowedModels = this.allowedModelsFor('follow');
        return this.base.getBacklinks(id, { ...options, models: options?.models?.filter((model) => allowedModels.includes(model)) ?? allowedModels });
    }
    async getRelated(id: string, options?: SdkGraphQueryOptions) {
        await this.assertGraphNodeAllowed(id, 'follow');
        const allowedModels = this.allowedModelsFor('follow');
        return this.base.getRelated(id, { ...options, models: options?.models?.filter((model) => allowedModels.includes(model)) ?? allowedModels });
    }
    getSubgraph(seedIds: string[], options?: SdkGraphQueryOptions) {
        const allowedModels = this.allowedModelsFor('follow');
        return this.base.getSubgraph(seedIds, { ...options, models: options?.models?.filter((model) => allowedModels.includes(model)) ?? allowedModels });
    }
    /** Primary graph workflow helper, scoped to followable models. */
    resolveSeeds(request: SdkGraphQueryRequest) {
        const allowedModels = this.allowedModelsFor('follow');
        return this.base.resolveSeeds({
            ...request,
            options: { ...request.options, models: request.options?.models?.filter((model) => allowedModels.includes(model)) ?? allowedModels },
        });
    }
    /** Primary graph workflow entrypoint for ranked graph retrieval, scoped to followable models. */
    queryGraph(request: SdkGraphQueryRequest) {
        const allowedModels = this.allowedModelsFor('follow');
        return this.base.queryGraph({
            ...request,
            options: { ...request.options, models: request.options?.models?.filter((model) => allowedModels.includes(model)) ?? allowedModels },
        });
    }
    /** Primary graph workflow entrypoint for prompt-ready context assembly, scoped to followable models. */
    buildContextPack(request: SdkContextPackRequest) {
        const allowedModels = this.allowedModelsFor('follow');
        return this.base.buildContextPack({
            ...request,
            options: { ...request.options, models: request.options?.models?.filter((model) => allowedModels.includes(model)) ?? allowedModels },
        });
    }
    parseGraphDsl(source: string) {
        return this.base.parseGraphDsl(source);
    }
    resolveReference(reference: string, options?: {
        fromNodeId?: string;
        fromPath?: string;
        models?: string[];
    }) {
        const allowedModels = this.allowedModelsFor('follow');
        return this.base.resolveReference(reference, { ...options, models: options?.models?.filter((model) => allowedModels.includes(model)) ?? allowedModels });
    }
    explainReferenceChain(fromId: string, toId: string) {
        return Promise.all([
            this.assertGraphNodeAllowed(fromId, 'follow'),
            this.assertGraphNodeAllowed(toId, 'follow'),
        ]).then(() => this.base.explainReferenceChain(fromId, toId));
    }
}
