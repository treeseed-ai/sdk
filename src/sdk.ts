import type { AgentPermissionConfig, AgentRuntimeSpec } from './types/agents.ts';
import { resolveSdkRepoRoot } from './runtime.ts';
import { normalizeAgentCliOptions } from './cli-tools.ts';
import { ContentStore } from './content-store.ts';
import { CloudflareD1AgentDatabase, MemoryAgentDatabase, type AgentDatabase } from './d1-store.ts';
import { ContentGraphRuntime } from './graph.ts';
import { buildScopedModelRegistry, resolveModelDefinition } from './model-registry.ts';
import type {
	SdkAckMessageRequest,
	SdkClaimMessageRequest,
	SdkClaimTaskRequest,
	SdkCloseWorkDayRequest,
	SdkCompleteTaskRequest,
	SdkCreateReportRequest,
	SdkCreateMessageRequest,
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
	SdkGraphRefreshRequest,
	SdkGraphSearchOptions,
	SdkPickRequest,
	SdkRecordRunRequest,
	SdkSearchRequest,
	SdkStartWorkDayRequest,
	SdkTaskProgressRequest,
	SdkTaskSearchRequest,
	SdkUpdateRequest,
	SdkModelDefinition,
	SdkModelRegistry,
} from './sdk-types.ts';
import { WranglerD1Database } from './wrangler-d1.ts';

export interface AgentSdkOptions {
	repoRoot?: string;
	database?: AgentDatabase;
	models?: SdkModelDefinition[];
	modelRegistry?: SdkModelRegistry;
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
	readonly database: AgentDatabase;
	readonly content: ContentStore;
	readonly models: SdkModelRegistry;
	private readonly graph: ContentGraphRuntime;

	constructor(options: AgentSdkOptions = {}) {
		const repoRoot = resolveSdkRepoRoot(options.repoRoot);
		this.models = options.modelRegistry ?? buildScopedModelRegistry(repoRoot, options.models);
		this.database = options.database ?? new MemoryAgentDatabase();
		this.content = new ContentStore(repoRoot, this.database, this.models);
		this.graph = new ContentGraphRuntime(repoRoot, this.models);
	}

	static createLocal(options: {
		repoRoot?: string;
		databaseName?: string;
		persistTo?: string;
		models?: SdkModelDefinition[];
		modelRegistry?: SdkModelRegistry;
	}) {
		const repoRoot = resolveSdkRepoRoot(options.repoRoot);
		const d1 = new WranglerD1Database(
			options.databaseName ?? 'karyon-docs-site-data',
			repoRoot,
			options.persistTo,
		);
		return new AgentSdk({
			repoRoot,
			database: new CloudflareD1AgentDatabase(d1),
			models: options.models,
			modelRegistry: options.modelRegistry,
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

	refreshGraph(request?: SdkGraphRefreshRequest) {
		return this.graph.refresh(request);
	}

	searchFiles(query: string, options?: SdkGraphSearchOptions) {
		return this.graph.searchFiles(query, options);
	}

	searchSections(query: string, options?: SdkGraphSearchOptions) {
		return this.graph.searchSections(query, options);
	}

	searchEntities(query: string, options?: SdkGraphSearchOptions) {
		return this.graph.searchEntities(query, options);
	}

	getGraphNode(id: string) {
		return this.graph.getNode(id);
	}

	getNeighbors(id: string, options?: SdkGraphQueryOptions) {
		return this.graph.getNeighbors(id, options);
	}

	followReferences(id: string, options?: SdkGraphQueryOptions) {
		return this.graph.followReferences(id, options);
	}

	getBacklinks(id: string, options?: SdkGraphQueryOptions) {
		return this.graph.getBacklinks(id, options);
	}

	getRelated(id: string, options?: SdkGraphQueryOptions) {
		return this.graph.getRelated(id, options);
	}

	getSubgraph(seedIds: string[], options?: SdkGraphQueryOptions) {
		return this.graph.getSubgraph(seedIds, options);
	}

	resolveReference(reference: string, options?: { fromNodeId?: string; fromPath?: string; models?: string[] }) {
		return this.graph.resolveReference(reference, options);
	}

	explainReferenceChain(fromId: string, toId: string) {
		return this.graph.explainReferenceChain(fromId, toId);
	}
}

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

	searchFiles(query: string, options?: SdkGraphSearchOptions) {
		const allowedModels = this.allowedModelsFor('search');
		return this.base.searchFiles(query, { ...options, models: options?.models?.filter((model) => allowedModels.includes(model)) ?? allowedModels });
	}

	searchSections(query: string, options?: SdkGraphSearchOptions) {
		const allowedModels = this.allowedModelsFor('search');
		return this.base.searchSections(query, { ...options, models: options?.models?.filter((model) => allowedModels.includes(model)) ?? allowedModels });
	}

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
