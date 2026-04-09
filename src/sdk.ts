import type { AgentPermissionConfig, AgentRuntimeSpec } from './types/agents.ts';
import { resolveSdkRepoRoot } from './runtime.ts';
import { normalizeAgentCliOptions } from './cli-tools.ts';
import { ContentStore } from './content-store.ts';
import { CloudflareD1AgentDatabase, MemoryAgentDatabase, type AgentDatabase } from './d1-store.ts';
import { buildModelRegistry, resolveModelDefinition } from './model-registry.ts';
import type {
	SdkAckMessageRequest,
	SdkClaimMessageRequest,
	SdkCreateMessageRequest,
	SdkCursorRequest,
	SdkFollowRequest,
	SdkGetRequest,
	SdkGetCursorRequest,
	SdkJsonEnvelope,
	SdkLeaseReleaseRequest,
	SdkMutationRequest,
	SdkPickRequest,
	SdkRecordRunRequest,
	SdkSearchRequest,
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

	constructor(options: AgentSdkOptions = {}) {
		const repoRoot = resolveSdkRepoRoot(options.repoRoot);
		this.models = options.modelRegistry ?? buildModelRegistry(options.models);
		this.database = options.database ?? new MemoryAgentDatabase();
		this.content = new ContentStore(repoRoot, this.database, this.models);
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
}
