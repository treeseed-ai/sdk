import type { AgentPermissionConfig, AgentRuntimeSpec } from './types/agents.ts';
import { resolveSdkRepoRoot } from './runtime.ts';
import { normalizeAgentCliOptions } from './cli-tools.ts';
import { ContentStore } from './content-store.ts';
import { CloudflareD1AgentDatabase, MemoryAgentDatabase, type AgentDatabase } from './d1-store.ts';
import { ContentGraphRuntime } from './graph.ts';
import { loadTreeseedPlugins, type LoadedTreeseedPluginEntry } from './platform/plugins.ts';
import { buildScopedModelRegistry, resolveModelDefinition } from './model-registry.ts';
import { findDispatchCapability } from './dispatch.ts';
import { RemoteTreeseedClient, RemoteTreeseedDispatchClient } from './remote.ts';
import { executeSdkOperation } from './sdk-dispatch.ts';
import { TreeseedOperationsSdk } from './operations/runtime.ts';
import type {
	ReleaseDetail,
	ReleaseSummary,
	SharePackageStatus,
	WorkstreamDetail,
	WorkstreamEvent,
	WorkstreamSummary,
} from './knowledge-coop.ts';
import type {
	SdkAckMessageRequest,
	SdkClaimMessageRequest,
	SdkClaimTaskRequest,
	SdkCloseWorkDayRequest,
	SdkCompleteTaskRequest,
	SdkCreateReportRequest,
	SdkCreateMessageRequest,
	SdkCreatePrioritySnapshotRequest,
	SdkCreateTaskRequest,
	SdkCursorRequest,
	SdkFailTaskRequest,
	SdkFollowRequest,
	SdkGetRequest,
	SdkGetCursorRequest,
	SdkJsonEnvelope,
	SdkLeaseReleaseRequest,
	SdkManagerContextPayload,
	SdkMutationRequest,
	SdkGraphQueryOptions,
	SdkGraphQueryRequest,
	SdkGraphRefreshRequest,
	SdkGraphSearchOptions,
	SdkContextPackRequest,
	SdkGraphDslParseResult,
	SdkPickRequest,
	SdkPriorityOverrideRequest,
	SdkRecordRunRequest,
	SdkRecordScaleDecisionRequest,
	SdkRecordTaskCreditsRequest,
	SdkSearchRequest,
	SdkStartWorkDayRequest,
	SdkTaskProgressRequest,
	SdkTaskSearchRequest,
	SdkUpsertWorkPolicyRequest,
	SdkUpdateRequest,
	SdkModelDefinition,
	SdkModelRegistry,
	SdkGraphRankingProvider,
	SdkDispatchConfig,
	SdkDispatchRequest,
	SdkDispatchResult,
	SdkDispatchCredentialSource,
	PrioritySnapshot,
	ScaleDecision,
	TaskCreditLedgerEntry,
	WorkdayPolicy,
} from './sdk-types.ts';
import { NodeSqliteD1Database } from './db/node-sqlite.ts';

export interface AgentSdkOptions {
	repoRoot?: string;
	database?: AgentDatabase;
	models?: SdkModelDefinition[];
	modelRegistry?: SdkModelRegistry;
	graphRankingProvider?: SdkGraphRankingProvider;
	plugins?: LoadedTreeseedPluginEntry[];
	dispatch?: SdkDispatchConfig;
}

function normalizeAgentSpec(entry: Record<string, unknown> | null): AgentRuntimeSpec | null {
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

function normalizeOperation(operation: string) {
	return operation === 'read' ? 'get' : operation;
}

function operationAllowed(
	permissions: AgentPermissionConfig[],
	model: string,
	operation: string,
) {
	const normalizedOperation = normalizeOperation(operation);
	return permissions.some(
		(permission) =>
			permission.model === model
			&& permission.operations.map(normalizeOperation).includes(normalizedOperation as AgentPermissionConfig['operations'][number]),
	);
}

export class AgentSdk {
	readonly repoRoot: string;
	readonly database: AgentDatabase;
	readonly content: ContentStore;
	readonly models: SdkModelRegistry;
	private readonly graph: ContentGraphRuntime;
	private readonly dispatchConfig?: SdkDispatchConfig;

	constructor(options: AgentSdkOptions = {}) {
		const repoRoot = resolveSdkRepoRoot(options.repoRoot);
		this.repoRoot = repoRoot;
		this.models = options.modelRegistry ?? buildScopedModelRegistry(repoRoot, options.models);
		this.database = options.database ?? new MemoryAgentDatabase();
		this.content = new ContentStore(repoRoot, this.database, this.models);
		let plugins = options.plugins;
		if (!plugins) {
			try {
				plugins = loadTreeseedPlugins();
			} catch {
				plugins = [];
			}
		}
		this.graph = new ContentGraphRuntime(repoRoot, this.models, {
			rankingProvider: options.graphRankingProvider,
			plugins,
		});
		this.dispatchConfig = options.dispatch;
	}

	static createLocal(options: {
		repoRoot?: string;
		databaseName?: string;
		persistTo?: string;
		models?: SdkModelDefinition[];
		modelRegistry?: SdkModelRegistry;
	}) {
		const repoRoot = resolveSdkRepoRoot(options.repoRoot);
		const d1 = new NodeSqliteD1Database(options.persistTo ?? options.databaseName ?? '.treeseed/generated/environments/local/site-data.sqlite');
		return new AgentSdk({
			repoRoot,
			database: new CloudflareD1AgentDatabase(d1),
			models: options.models,
			modelRegistry: options.modelRegistry,
		});
	}

	private async resolveDispatchToken(source: SdkDispatchCredentialSource | undefined) {
		if (!source) {
			return null;
		}
		if (source.type === 'bearer') {
			return source.token;
		}
		return await source.resolveToken();
	}

	private async executeDispatchLocally(request: SdkDispatchRequest) {
		const namespace = request.namespace ?? 'sdk';
		if (namespace === 'workflow') {
			const operations = new TreeseedOperationsSdk();
			return operations.execute({
				operationName: request.operation,
				input: request.input ?? {},
			}, {
				cwd: this.repoRoot,
				env: process.env,
				transport: 'sdk',
			});
		}
		return executeSdkOperation(this, request.operation, request.input ?? {});
	}

	async dispatch(request: SdkDispatchRequest): Promise<SdkDispatchResult> {
		const namespace = request.namespace ?? 'sdk';
		const capability = findDispatchCapability(namespace, request.operation);
		if (!capability) {
			throw new Error(`Unknown dispatch operation "${namespace}:${request.operation}".`);
		}

		const preferredMode = request.preferredMode ?? this.dispatchConfig?.policy ?? capability.defaultDispatchMode;
		const dispatchConfig = this.dispatchConfig;
		if (!dispatchConfig && preferredMode === 'remote_only') {
			throw new Error(`Dispatch for "${namespace}:${request.operation}" requires a remote market configuration.`);
		}
		const shouldStayLocal =
			capability.executionClass === 'local_only'
			|| !dispatchConfig
			|| preferredMode === 'prefer_local';

		if (shouldStayLocal) {
			return {
				ok: true,
				mode: 'inline',
				namespace,
				operation: request.operation,
				target: 'local',
				capability,
				payload: await this.executeDispatchLocally({ ...request, namespace }),
			};
		}

		const token = await this.resolveDispatchToken(dispatchConfig.credentialSource);
		const client = new RemoteTreeseedDispatchClient(new RemoteTreeseedClient({
			hosts: [{ id: 'market', baseUrl: dispatchConfig.marketBaseUrl }],
			activeHostId: 'market',
			auth: token ? { accessToken: token } : undefined,
		}, {
			fetchImpl: dispatchConfig.fetchImpl,
		}));

		return client.dispatch(dispatchConfig.projectId, {
			...request,
			namespace,
			preferredMode,
		});
	}

	private envelope<TPayload>(
		model: string,
		operation: SdkJsonEnvelope<TPayload>['operation'],
		payload: TPayload,
		meta?: Record<string, unknown>,
	): SdkJsonEnvelope<TPayload> {
		return {
			ok: true,
			model: resolveModelDefinition(model, this.models).name,
			operation,
			payload,
			meta,
		};
	}

	async get(request: SdkGetRequest) {
		const definition = resolveModelDefinition(request.model, this.models);
		const payload =
			definition.storage === 'content'
				? await this.content.get({ ...request, model: definition.name })
				: await this.database.get({ ...request, model: definition.name });
		return this.envelope(definition.name, 'get', payload);
	}

	read(request: SdkGetRequest) {
		return this.get(request).then((response) => ({
			...response,
			operation: 'read' as const,
		}));
	}

	async search(request: SdkSearchRequest) {
		const definition = resolveModelDefinition(request.model, this.models);
		const payload =
			definition.storage === 'content'
				? await this.content.search({ ...request, model: definition.name })
				: await this.database.search({ ...request, model: definition.name });
		return this.envelope(definition.name, 'search', payload, {
			count: Array.isArray(payload) ? payload.length : 0,
		});
	}

	async follow(request: SdkFollowRequest) {
		const definition = resolveModelDefinition(request.model, this.models);
		const payload =
			definition.storage === 'content'
				? await this.content.follow({ ...request, model: definition.name })
				: await this.database.follow({ ...request, model: definition.name });
		return this.envelope(definition.name, 'follow', payload, {
			count: payload.items.length,
		});
	}

	async pick(request: SdkPickRequest) {
		const definition = resolveModelDefinition(request.model, this.models);
		const payload =
			definition.storage === 'content'
				? await this.content.pick({ ...request, model: definition.name })
				: await this.database.pick({ ...request, model: definition.name });
		return this.envelope(definition.name, 'pick', payload, {
			claimed: Boolean(payload.item),
		});
	}

	async create(request: SdkMutationRequest) {
		const definition = resolveModelDefinition(request.model, this.models);
		const payload =
			definition.storage === 'content'
				? await this.content.create({ ...request, model: definition.name })
				: await this.database.create({ ...request, model: definition.name });
		return this.envelope(definition.name, 'create', payload);
	}

	async update(request: SdkUpdateRequest) {
		const definition = resolveModelDefinition(request.model, this.models);
		const payload =
			definition.storage === 'content'
				? await this.content.update({ ...request, model: definition.name })
				: await this.database.update({ ...request, model: definition.name });
		return this.envelope(definition.name, 'update', payload);
	}

	async claimMessage(request: SdkClaimMessageRequest) {
		const payload = await this.database.claimMessage(request);
		return this.envelope('message', 'pick', payload, {
			claimed: Boolean(payload),
		});
	}

	async ackMessage(request: SdkAckMessageRequest) {
		await this.database.ackMessage(request);
		return this.envelope('message', 'update', { id: request.id, status: request.status });
	}

	async createMessage(request: SdkCreateMessageRequest) {
		const payload = await this.database.createMessage(request);
		return this.envelope('message', 'create', payload);
	}

	async recordRun(request: SdkRecordRunRequest) {
		const payload = await this.database.recordRun(request);
		return this.envelope('agent_run', 'update', payload);
	}

	async getCursor(request: SdkGetCursorRequest) {
		const payload = await this.database.getCursor(request);
		return this.envelope('agent_cursor', 'get', payload);
	}

	async upsertCursor(request: SdkCursorRequest) {
		await this.database.upsertCursor(request);
		return this.envelope('agent_cursor', 'update', request);
	}

	async releaseLease(request: SdkLeaseReleaseRequest) {
		await this.database.releaseLease(request);
		return this.envelope('content_lease', 'update', request);
	}

	async releaseAllLeases() {
		const count = await this.database.releaseAllLeases();
		return this.envelope('content_lease', 'update', { count });
	}

	async startWorkDay(request: SdkStartWorkDayRequest) {
		const payload = await this.database.startWorkDay(request);
		return this.envelope('work_day', 'create', payload);
	}

	async closeWorkDay(request: SdkCloseWorkDayRequest) {
		const payload = await this.database.closeWorkDay(request);
		return this.envelope('work_day', 'update', payload);
	}

	async createTask(request: SdkCreateTaskRequest) {
		const payload = await this.database.createTask(request);
		return this.envelope('task', 'create', payload);
	}

	async claimTask(request: SdkClaimTaskRequest) {
		const payload = await this.database.claimTask(request);
		return this.envelope('task', 'update', payload);
	}

	async recordTaskProgress(request: SdkTaskProgressRequest) {
		const payload = await this.database.recordTaskProgress(request);
		return this.envelope('task', 'update', payload);
	}

	async completeTask(request: SdkCompleteTaskRequest) {
		const payload = await this.database.completeTask(request);
		return this.envelope('task', 'update', payload);
	}

	async failTask(request: SdkFailTaskRequest) {
		const payload = await this.database.failTask(request);
		return this.envelope('task', 'update', payload);
	}

	async appendTaskEvent(request: {
		taskId: string;
		kind: string;
		data?: Record<string, unknown>;
		actor: string;
	}) {
		const payload = await this.database.appendTaskEvent(request);
		return this.envelope('task_event', 'create', payload);
	}

	async searchTasks(request: SdkTaskSearchRequest) {
		const payload = await this.database.searchTasks(request);
		return this.envelope('task', 'search', payload, { count: payload.length });
	}

	async createReport(request: SdkCreateReportRequest) {
		const payload = await this.database.createReport(request);
		return this.envelope('report', 'create', payload);
	}

	async getManagerContext(taskId: string) {
		const payload = await this.database.getManagerContext(taskId);
		return this.envelope<SdkManagerContextPayload>('task', 'get', payload);
	}

	async getWorkPolicy(projectId: string, environment: string = 'local') {
		const payload = await this.database.getWorkPolicy(projectId, environment);
		return this.envelope<WorkdayPolicy>('work_day', 'get', payload);
	}

	async upsertWorkPolicy(request: SdkUpsertWorkPolicyRequest) {
		const payload = await this.database.upsertWorkPolicy(request);
		return this.envelope<WorkdayPolicy>('work_day', 'update', payload);
	}

	async listPriorityOverrides(projectId: string) {
		const payload = await this.database.listPriorityOverrides(projectId);
		return this.envelope('task', 'search', payload, { count: payload.length });
	}

	async upsertPriorityOverride(request: SdkPriorityOverrideRequest) {
		const payload = await this.database.upsertPriorityOverride(request);
		return this.envelope('task', 'update', payload);
	}

	async createPrioritySnapshot(request: SdkCreatePrioritySnapshotRequest) {
		const payload = await this.database.createPrioritySnapshot(request);
		return this.envelope<PrioritySnapshot>('report', 'create', payload);
	}

	async getLatestPrioritySnapshot(projectId: string, workDayId?: string | null) {
		const payload = await this.database.getLatestPrioritySnapshot(projectId, workDayId);
		return this.envelope<PrioritySnapshot>('report', 'get', payload);
	}

	async recordTaskCredits(request: SdkRecordTaskCreditsRequest) {
		const payload = await this.database.recordTaskCredits(request);
		return this.envelope<TaskCreditLedgerEntry>('report', 'create', payload);
	}

	async listTaskCredits(workDayId: string) {
		const payload = await this.database.listTaskCredits(workDayId);
		return this.envelope<TaskCreditLedgerEntry[]>('report', 'search', payload, { count: payload.length });
	}

	async recordScaleDecision(request: SdkRecordScaleDecisionRequest) {
		const payload = await this.database.recordScaleDecision(request);
		return this.envelope<ScaleDecision>('report', 'create', payload);
	}

	async getLatestScaleDecision(projectId: string, environment: string, poolName: string) {
		const payload = await this.database.getLatestScaleDecision(projectId, environment, poolName);
		return this.envelope<ScaleDecision>('report', 'get', payload);
	}

	async listWorkstreams(projectId: string) {
		const payload = await this.database.listWorkstreams(projectId);
		return this.envelope<WorkstreamSummary[]>('task', 'search', payload, { count: payload.length });
	}

	async getWorkstream(workstreamId: string) {
		const payload = await this.database.getWorkstream(workstreamId);
		return this.envelope<WorkstreamDetail>('task', 'get', payload);
	}

	async upsertWorkstream(input: Partial<WorkstreamSummary> & Pick<WorkstreamSummary, 'projectId' | 'title'>) {
		const payload = await this.database.upsertWorkstream(input);
		return this.envelope<WorkstreamSummary>('task', 'update', payload);
	}

	async appendWorkstreamEvent(input: Pick<WorkstreamEvent, 'projectId' | 'workstreamId' | 'kind'> & Partial<WorkstreamEvent>) {
		const payload = await this.database.appendWorkstreamEvent(input);
		return this.envelope<WorkstreamEvent>('task_event', 'create', payload);
	}

	async listReleases(projectId: string) {
		const payload = await this.database.listReleases(projectId);
		return this.envelope<ReleaseSummary[]>('report', 'search', payload, { count: payload.length });
	}

	async getRelease(releaseId: string) {
		const payload = await this.database.getRelease(releaseId);
		return this.envelope<ReleaseDetail>('report', 'get', payload);
	}

	async upsertRelease(input: Partial<ReleaseSummary> & Pick<ReleaseSummary, 'projectId' | 'version'> & { items?: ReleaseDetail['items'] }) {
		const payload = await this.database.upsertRelease(input);
		return this.envelope<ReleaseDetail>('report', 'update', payload);
	}

	async listSharePackages(projectId: string) {
		const payload = await this.database.listSharePackages(projectId);
		return this.envelope<SharePackageStatus[]>('report', 'search', payload, { count: payload.length });
	}

	async getSharePackage(packageId: string) {
		const payload = await this.database.getSharePackage(packageId);
		return this.envelope<SharePackageStatus>('report', 'get', payload);
	}

	async upsertSharePackage(input: Partial<SharePackageStatus> & Pick<SharePackageStatus, 'projectId' | 'kind' | 'title'>) {
		const payload = await this.database.upsertSharePackage(input);
		return this.envelope<SharePackageStatus>('report', 'update', payload);
	}

	async listAgentSpecs(options?: { enabled?: boolean }) {
		const rawEntries = await this.listRawAgentSpecs(options);
		return rawEntries
			.map((entry) => normalizeAgentSpec(entry as Record<string, unknown>))
			.filter((entry): entry is AgentRuntimeSpec => Boolean(entry && entry.slug));
	}

	async listRawAgentSpecs(options?: { enabled?: boolean }) {
		const filters =
			typeof options?.enabled === 'boolean'
				? [{ field: 'enabled', op: 'eq' as const, value: options.enabled }]
				: [];
		const response = await this.search({
			model: 'agent',
			filters,
			sort: [{ field: 'name', direction: 'asc' }],
		});
		return response.payload;
	}

	scopeForAgent(agent: Pick<AgentRuntimeSpec, 'slug' | 'permissions'>) {
		return new ScopedAgentSdk(this, agent.slug, agent.permissions);
	}

	/** Advanced graph maintenance helper. Most application code should use parseGraphDsl() -> queryGraph() -> buildContextPack(). */
	refreshGraph(request?: SdkGraphRefreshRequest) {
		return this.graph.refresh(request);
	}

	/** Advanced lexical graph primitive for file nodes. Prefer queryGraph() or buildContextPack() for AI-context retrieval. */
	searchFiles(query: string, options?: SdkGraphSearchOptions) {
		return this.graph.searchFiles(query, options);
	}

	/** Advanced lexical graph primitive for section nodes. Prefer queryGraph() or buildContextPack() for AI-context retrieval. */
	searchSections(query: string, options?: SdkGraphSearchOptions) {
		return this.graph.searchSections(query, options);
	}

	/** Advanced lexical graph primitive for entity nodes. Prefer queryGraph() or buildContextPack() for AI-context retrieval. */
	searchEntities(query: string, options?: SdkGraphSearchOptions) {
		return this.graph.searchEntities(query, options);
	}

	/** Advanced graph primitive that returns one raw graph node by id. */
	getGraphNode(id: string) {
		return this.graph.getNode(id);
	}

	/** Advanced graph primitive for direct neighborhood inspection. Prefer queryGraph() for ranked retrieval. */
	getNeighbors(id: string, options?: SdkGraphQueryOptions) {
		return this.graph.getNeighbors(id, options);
	}

	/** Advanced traversal primitive for direct reference walking. Prefer queryGraph() when you need ranking and ctx-aware behavior. */
	followReferences(id: string, options?: SdkGraphQueryOptions) {
		return this.graph.followReferences(id, options);
	}

	/** Advanced graph primitive for incoming-link inspection. */
	getBacklinks(id: string, options?: SdkGraphQueryOptions) {
		return this.graph.getBacklinks(id, options);
	}

	/** Advanced graph primitive for local relatedness. Prefer queryGraph() for the primary ranked graph workflow. */
	getRelated(id: string, options?: SdkGraphQueryOptions) {
		return this.graph.getRelated(id, options);
	}

	/** Advanced traversal primitive for raw subgraph extraction. Prefer buildContextPack() when you need prompt-ready output. */
	getSubgraph(seedIds: string[], options?: SdkGraphQueryOptions) {
		return this.graph.getSubgraph(seedIds, options);
	}

	/** Primary graph workflow helper. Resolves roots before ranking and traversal. */
	resolveSeeds(request: SdkGraphQueryRequest) {
		return this.graph.resolveSeeds(request);
	}

	/** Primary graph workflow entrypoint for ranked graph retrieval. */
	queryGraph(request: SdkGraphQueryRequest) {
		return this.graph.queryGraph(request);
	}

	/** Primary graph workflow entrypoint for prompt-ready AI context assembly. */
	buildContextPack(request: SdkContextPackRequest) {
		return this.graph.buildContextPack(request);
	}

	/** Primary graph workflow helper. Parses the public ctx DSL into a typed graph request. */
	parseGraphDsl(source: string): Promise<SdkGraphDslParseResult> {
		return this.graph.parseGraphDsl(source);
	}

	/** Primary graph workflow helper for resolving ids, paths, and anchors into graph nodes. */
	resolveReference(reference: string, options?: { fromNodeId?: string; fromPath?: string; models?: string[] }) {
		return this.graph.resolveReference(reference, options);
	}

	/** Primary graph workflow helper for explaining why two nodes are connected. */
	explainReferenceChain(fromId: string, toId: string) {
		return this.graph.explainReferenceChain(fromId, toId);
	}
}

/** Operational SDK wrapper that enforces agent permissions on top of AgentSdk. */
export class ScopedAgentSdk {
	constructor(
		private readonly base: AgentSdk,
		private readonly actor: string,
		private readonly permissions: AgentPermissionConfig[],
	) {}

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

	resolveReference(reference: string, options?: { fromNodeId?: string; fromPath?: string; models?: string[] }) {
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
