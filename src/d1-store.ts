import crypto from 'node:crypto';
import type { ContentLeaseRecord } from './types/agents.ts';
import type { D1DatabaseLike } from './types/cloudflare.ts';
import { applyFilters, applySort } from './sdk-filters.ts';
import type {
	SdkAckMessageRequest,
	SdkClaimMessageRequest,
	SdkCreateMessageRequest,
	SdkCursorEntity,
	SdkCursorRequest,
	SdkFilterCondition,
	SdkFollowRequest,
	SdkGetRequest,
	SdkGetCursorRequest,
	SdkLeaseEntity,
	SdkLeaseReleaseRequest,
	SdkMessageEntity,
	SdkMutationRequest,
	SdkPickRequest,
	SdkPickResult,
	SdkRecordRunRequest,
	SdkRunEntity,
	SdkSearchRequest,
	SdkSubscriptionEntity,
	SdkUpdateRequest,
} from './sdk-types.ts';
import { CursorStore } from './stores/cursor-store.ts';
import { LeaseStore, type LeaseClaimInput } from './stores/lease-store.ts';
import { MessageStore } from './stores/message-store.ts';
import { RunStore } from './stores/run-store.ts';
import { SubscriptionStore } from './stores/subscription-store.ts';

export interface TryClaimContentLeaseInput extends LeaseClaimInput {}

type D1Record =
	| SdkSubscriptionEntity
	| SdkMessageEntity
	| SdkRunEntity
	| SdkCursorEntity
	| SdkLeaseEntity;

export interface AgentDatabase {
	get(request: SdkGetRequest): Promise<Record<string, unknown> | null>;
	search(request: SdkSearchRequest): Promise<Record<string, unknown>[]>;
	follow(request: SdkFollowRequest): Promise<{ items: Record<string, unknown>[]; since: string }>;
	pick(request: SdkPickRequest): Promise<SdkPickResult<Record<string, unknown>>>;
	create(request: SdkMutationRequest): Promise<Record<string, unknown>>;
	update(request: SdkUpdateRequest): Promise<Record<string, unknown> | null>;
	claimMessage(request: SdkClaimMessageRequest): Promise<SdkMessageEntity | null>;
	ackMessage(request: SdkAckMessageRequest): Promise<void>;
	createMessage(request: SdkCreateMessageRequest): Promise<SdkMessageEntity>;
	recordRun(request: SdkRecordRunRequest): Promise<Record<string, unknown>>;
	getCursor(request: SdkGetCursorRequest): Promise<string | null>;
	upsertCursor(request: SdkCursorRequest): Promise<void>;
	releaseLease(request: SdkLeaseReleaseRequest): Promise<void>;
	tryClaimContentLease(input: TryClaimContentLeaseInput): Promise<string | null>;
	releaseAllLeases(): Promise<number>;
}

function nowIso() {
	return new Date().toISOString();
}

function nextLeaseToken() {
	return crypto.randomUUID();
}

function filterSinceField(model: string) {
	switch (model) {
		case 'message':
		case 'subscription':
			return 'updated_at';
		case 'agent_run':
			return 'startedAt';
		case 'agent_cursor':
			return 'updatedAt';
		case 'content_lease':
			return 'leaseExpiresAt';
		default:
			return 'updatedAt';
	}
}

export class MemoryAgentDatabase implements AgentDatabase {
	private readonly subscriptions = new Map<string, SdkSubscriptionEntity>();
	private readonly messages = new Map<number, SdkMessageEntity>();
	private readonly runs = new Map<string, SdkRunEntity>();
	private readonly contentLeases = new Map<string, ContentLeaseRecord>();
	private readonly cursors = new Map<string, string>();
	private messageId = 0;

	constructor(seed?: {
		subscriptions?: SdkSubscriptionEntity[];
		messages?: SdkMessageEntity[];
		runs?: SdkRunEntity[];
		cursors?: SdkCursorEntity[];
		leases?: SdkLeaseEntity[];
	}) {
		for (const item of seed?.subscriptions ?? []) {
			this.subscriptions.set(String(item.id ?? item.email), item);
		}
		for (const message of seed?.messages ?? []) {
			this.messages.set(message.id, message);
			this.messageId = Math.max(this.messageId, message.id);
		}
		for (const run of seed?.runs ?? []) {
			this.runs.set(run.runId, run);
		}
		for (const cursor of seed?.cursors ?? []) {
			this.cursors.set(`${cursor.agentSlug}:${cursor.cursorKey}`, cursor.cursorValue);
		}
		for (const lease of seed?.leases ?? []) {
			this.contentLeases.set(`${lease.model}:${lease.itemKey}`, lease);
		}
	}

	private rowsForModel(model: string): D1Record[] {
		if (model === 'subscription') {
			return [...this.subscriptions.values()];
		}
		if (model === 'message') {
			return [...this.messages.values()];
		}
		if (model === 'agent_run') {
			return [...this.runs.values()];
		}
		if (model === 'agent_cursor') {
			return [...this.cursors.entries()].map(([key, value]) => {
				const [agentSlug, cursorKey] = key.split(':', 2);
				return {
					agentSlug,
					cursorKey,
					cursorValue: value,
					updatedAt: null,
				};
			});
		}
		if (model === 'content_lease') {
			return [...this.contentLeases.values()].map((lease) => ({
				model: lease.model,
				itemKey: lease.itemKey,
				claimedBy: lease.claimedBy,
				claimedAt: lease.claimedAt,
				leaseExpiresAt: lease.leaseExpiresAt,
				token: lease.token,
			}));
		}
		throw new Error(`Unsupported D1 model "${model}".`);
	}

	async get(request: SdkGetRequest) {
		const key = String(request.id ?? request.slug ?? request.key ?? '');
		if (request.model === 'agent_cursor') {
			if (!key) {
				return null;
			}
			const [agentSlug, cursorKey] = key.split(':', 2);
			const value = this.cursors.get(`${agentSlug}:${cursorKey}`);
			return value
				? {
					agentSlug,
					cursorKey,
					cursorValue: value,
					updatedAt: null,
				}
				: null;
		}
		if (request.model === 'content_lease') {
			const lease = this.contentLeases.get(key);
			return lease
				? {
					model: lease.model,
					itemKey: lease.itemKey,
					claimedBy: lease.claimedBy,
					claimedAt: lease.claimedAt,
					leaseExpiresAt: lease.leaseExpiresAt,
					token: lease.token,
				}
				: null;
		}
		return (
			this.rowsForModel(request.model).find((row) =>
				[row.id, row.email, row.runId].map((value) => String(value ?? '')).includes(key),
			) ?? null
		) as Record<string, unknown> | null;
	}

	async search(request: SdkSearchRequest) {
		const filtered = applyFilters(this.rowsForModel(request.model) as Record<string, unknown>[], request.filters);
		const sorted = applySort(filtered as Record<string, unknown>[], request.sort);
		return sorted.slice(0, request.limit ?? sorted.length) as Record<string, unknown>[];
	}

	async follow(request: SdkFollowRequest) {
		const filters: SdkFilterCondition[] = [
			...(request.filters ?? []),
			{
				field: filterSinceField(request.model),
				op: 'updated_since',
				value: request.since,
			},
		];
		return {
			items: await this.search({
				model: request.model,
				filters,
			}),
			since: request.since,
		};
	}

	async pick(request: SdkPickRequest): Promise<SdkPickResult<Record<string, unknown>>> {
		if (request.model === 'message') {
			const item = await this.claimMessage({
				workerId: request.workerId,
				messageTypes: request.filters
					?.filter((filter) => filter.field === 'type' && filter.op === 'in')
					.flatMap((filter) => (Array.isArray(filter.value) ? filter.value.map(String) : [])),
				leaseSeconds: request.leaseSeconds,
			});
			return {
				item: item as Record<string, unknown> | null,
				leaseToken: item ? nextLeaseToken() : null,
			};
		}

		if (request.model === 'content_lease') {
			const item = (await this.search({
				model: request.model,
				filters: request.filters,
				sort: [{ field: 'leaseExpiresAt', direction: 'desc' }],
				limit: 1,
			}))[0];
			return {
				item: item ?? null,
				leaseToken: item ? String((item as SdkLeaseEntity).token) : null,
			};
		}

		const items = await this.search({
			model: request.model,
			filters: request.filters,
			sort: [{ field: filterSinceField(request.model), direction: 'desc' }],
		});
		return {
			item: items[0] ?? null,
			leaseToken: null,
		};
	}

	async create(request: SdkMutationRequest) {
		switch (request.model) {
			case 'message':
				return (await this.createMessage({
					type: String(request.data.type ?? 'message.created'),
					payload: (request.data.payload as Record<string, unknown> | undefined) ?? request.data,
					relatedModel: typeof request.data.relatedModel === 'string' ? request.data.relatedModel : null,
					relatedId: typeof request.data.relatedId === 'string' ? request.data.relatedId : null,
					priority: Number(request.data.priority ?? 0),
					maxAttempts: Number(request.data.maxAttempts ?? 3),
					actor: request.actor,
				})) as Record<string, unknown>;
			case 'subscription': {
				const record: SdkSubscriptionEntity = {
					id: this.subscriptions.size + 1,
					email: String(request.data.email ?? ''),
					name: request.data.name ? String(request.data.name) : null,
					status: String(request.data.status ?? 'active'),
					source: String(request.data.source ?? 'sdk'),
					consent_at: String(request.data.consent_at ?? nowIso()),
					created_at: String(request.data.created_at ?? nowIso()),
					updated_at: String(request.data.updated_at ?? nowIso()),
					ip_hash: String(request.data.ip_hash ?? ''),
				};
				this.subscriptions.set(String(record.id), record);
				return record;
			}
			case 'agent_run':
				return this.recordRun({ run: request.data });
			case 'agent_cursor': {
				const agentSlug = String(request.data.agentSlug ?? '');
				const cursorKey = String(request.data.cursorKey ?? '');
				const cursorValue = String(request.data.cursorValue ?? '');
				this.cursors.set(`${agentSlug}:${cursorKey}`, cursorValue);
				return {
					agentSlug,
					cursorKey,
					cursorValue,
					updatedAt: nowIso(),
				};
			}
			case 'content_lease': {
				const token = await this.tryClaimContentLease({
					model: String(request.data.model ?? ''),
					itemKey: String(request.data.itemKey ?? ''),
					claimedBy: String(request.data.claimedBy ?? request.actor),
					leaseSeconds: Number(request.data.leaseSeconds ?? 300),
				});
				const lease = this.contentLeases.get(`${request.data.model}:${request.data.itemKey}`);
				return {
					model: String(request.data.model ?? ''),
					itemKey: String(request.data.itemKey ?? ''),
					claimedBy: String(request.data.claimedBy ?? request.actor),
					claimedAt: String(lease?.claimedAt ?? nowIso()),
					leaseExpiresAt: String(lease?.leaseExpiresAt ?? nowIso()),
					token: String(token ?? lease?.token ?? ''),
				};
			}
			default:
				throw new Error(`Unsupported D1 create model "${request.model}".`);
		}
	}

	async update(request: SdkUpdateRequest) {
		switch (request.model) {
			case 'message': {
				const current = this.messages.get(Number(request.id ?? request.key ?? request.data.id ?? 0));
				if (!current) {
					return null;
				}
				const next = {
					...current,
					...request.data,
					updatedAt: nowIso(),
				} as SdkMessageEntity;
				this.messages.set(next.id, next);
				return next;
			}
			case 'subscription': {
				const key = String(request.id ?? request.key ?? request.data.email ?? '');
				const current = (await this.get({ model: 'subscription', key })) as SdkSubscriptionEntity | null;
				if (!current) {
					return null;
				}
				const next = {
					...current,
					...request.data,
					updated_at: nowIso(),
				};
				this.subscriptions.set(String(next.id ?? next.email), next);
				return next;
			}
			case 'agent_run':
				return this.recordRun({ run: { ...request.data, runId: request.id ?? request.key ?? request.data.runId } });
			case 'agent_cursor':
				return this.create({
					model: 'agent_cursor',
					data: request.data,
					actor: request.actor,
				});
			case 'content_lease':
				return this.create({
					model: 'content_lease',
					data: request.data,
					actor: request.actor,
				});
			default:
				throw new Error(`Unsupported D1 update model "${request.model}".`);
		}
	}

	async claimMessage(request: SdkClaimMessageRequest) {
		const pending = [...this.messages.values()]
			.filter((message) =>
				(message.status === 'pending' || message.status === 'failed')
				&& new Date(message.availableAt).valueOf() <= Date.now()
				&& (!request.messageTypes?.length || request.messageTypes.includes(message.type)),
			)
			.sort((left, right) => right.priority - left.priority || left.availableAt.localeCompare(right.availableAt))[0];
		if (!pending) {
			return null;
		}

		const claimedAt = nowIso();
		const next: SdkMessageEntity = {
			...pending,
			status: 'claimed',
			claimedBy: request.workerId,
			claimedAt,
			leaseExpiresAt: new Date(Date.now() + request.leaseSeconds * 1000).toISOString(),
			attempts: pending.attempts + 1,
			updatedAt: claimedAt,
		};
		this.messages.set(next.id, next);
		return next;
	}

	async ackMessage(request: SdkAckMessageRequest) {
		const current = this.messages.get(request.id);
		if (!current) {
			return;
		}
		this.messages.set(request.id, {
			...current,
			status: request.status,
			updatedAt: nowIso(),
		});
	}

	async createMessage(request: SdkCreateMessageRequest) {
		this.messageId += 1;
		const record: SdkMessageEntity = {
			id: this.messageId,
			type: request.type,
			status: 'pending',
			payloadJson: JSON.stringify(request.payload),
			relatedModel: request.relatedModel ?? null,
			relatedId: request.relatedId ?? null,
			priority: request.priority ?? 0,
			availableAt: nowIso(),
			claimedBy: null,
			claimedAt: null,
			leaseExpiresAt: null,
			attempts: 0,
			maxAttempts: request.maxAttempts ?? 3,
			createdAt: nowIso(),
			updatedAt: nowIso(),
		};
		this.messages.set(record.id, record);
		return record;
	}

	async recordRun(request: SdkRecordRunRequest) {
		const run = request.run as SdkRunEntity;
		this.runs.set(String(run.runId), run);
		return run;
	}

	async getCursor(request: SdkGetCursorRequest) {
		return this.cursors.get(`${request.agentSlug}:${request.cursorKey}`) ?? null;
	}

	async upsertCursor(request: SdkCursorRequest) {
		this.cursors.set(`${request.agentSlug}:${request.cursorKey}`, request.cursorValue);
	}

	async releaseLease(request: SdkLeaseReleaseRequest) {
		this.contentLeases.delete(`${request.model}:${request.itemKey}`);
	}

	async tryClaimContentLease(input: TryClaimContentLeaseInput) {
		const key = `${input.model}:${input.itemKey}`;
		const existing = this.contentLeases.get(key);
		if (existing && new Date(existing.leaseExpiresAt).valueOf() > Date.now()) {
			return null;
		}
		const token = nextLeaseToken();
		this.contentLeases.set(key, {
			model: input.model,
			itemKey: input.itemKey,
			claimedBy: input.claimedBy,
			claimedAt: nowIso(),
			leaseExpiresAt: new Date(Date.now() + input.leaseSeconds * 1000).toISOString(),
			token,
		});
		return token;
	}

	async releaseAllLeases() {
		const count = this.contentLeases.size;
		this.contentLeases.clear();
		return count;
	}

	inspectRuns() {
		return [...this.runs.values()];
	}

	inspectLeases() {
		return [...this.contentLeases.values()];
	}
}

export class CloudflareD1AgentDatabase implements AgentDatabase {
	private readonly subscriptions: SubscriptionStore;
	private readonly messages: MessageStore;
	private readonly runs: RunStore;
	private readonly cursors: CursorStore;
	private readonly leases: LeaseStore;

	constructor(readonly db: D1DatabaseLike) {
		this.subscriptions = new SubscriptionStore(db);
		this.messages = new MessageStore(db);
		this.runs = new RunStore(db);
		this.cursors = new CursorStore(db);
		this.leases = new LeaseStore(db);
	}

	async get(request: SdkGetRequest) {
		if (request.model === 'subscription') {
			return this.subscriptions.getByKey(String(request.id ?? request.slug ?? request.key ?? '')) as Promise<Record<string, unknown> | null>;
		}
		if (request.model === 'message') {
			return this.messages.getById(Number(request.id ?? request.slug ?? request.key ?? 0)) as Promise<Record<string, unknown> | null>;
		}
		if (request.model === 'agent_run') {
			return this.runs.getByKey(String(request.id ?? request.key ?? request.slug ?? '')) as Promise<Record<string, unknown> | null>;
		}
		if (request.model === 'agent_cursor') {
			return this.cursors.getByKey(String(request.id ?? request.key ?? request.slug ?? '')) as Promise<Record<string, unknown> | null>;
		}
		if (request.model === 'content_lease') {
			return this.leases.getByKey(String(request.id ?? request.key ?? request.slug ?? '')) as Promise<Record<string, unknown> | null>;
		}
		throw new Error(`Unsupported D1 get model "${request.model}".`);
	}

	async search(request: SdkSearchRequest) {
		if (request.model === 'subscription') {
			return this.subscriptions.search(request) as Promise<Record<string, unknown>[]>;
		}
		if (request.model === 'message') {
			return this.messages.search(request) as Promise<Record<string, unknown>[]>;
		}
		if (request.model === 'agent_run') {
			return this.runs.search(request) as Promise<Record<string, unknown>[]>;
		}
		if (request.model === 'agent_cursor') {
			return this.cursors.search(request) as Promise<Record<string, unknown>[]>;
		}
		if (request.model === 'content_lease') {
			return this.leases.search(request) as Promise<Record<string, unknown>[]>;
		}
		throw new Error(`Unsupported D1 search model "${request.model}".`);
	}

	async follow(request: SdkFollowRequest) {
		const field =
			request.model === 'subscription' || request.model === 'message'
				? 'updated_at'
				: request.model === 'agent_run'
					? 'started_at'
					: request.model === 'agent_cursor'
						? 'updated_at'
						: 'lease_expires_at';
		return this.search({
			model: request.model,
			filters: [
				...(request.filters ?? []),
				{ field, op: 'updated_since', value: request.since },
			],
		}).then((items) => ({ items, since: request.since }));
	}

	async pick(request: SdkPickRequest) {
		if (request.model === 'message') {
			const claimed = await this.claimMessage({
				workerId: request.workerId,
				messageTypes: request.filters
					?.filter((filter) => filter.field === 'type' && filter.op === 'in')
					.flatMap((filter) => (Array.isArray(filter.value) ? filter.value.map(String) : [])),
				leaseSeconds: request.leaseSeconds,
			});
			return {
				item: claimed as Record<string, unknown> | null,
				leaseToken: claimed ? nextLeaseToken() : null,
			};
		}
		if (request.model === 'content_lease') {
			const items = await this.leases.search({
				model: 'content_lease',
				filters: request.filters,
				sort: [{ field: 'lease_expires_at', direction: 'desc' }],
				limit: 1,
			});
			return {
				item: (items[0] ?? null) as Record<string, unknown> | null,
				leaseToken: items[0]?.token ?? null,
			};
		}
		return {
			item: null,
			leaseToken: null,
		};
	}

	async create(request: SdkMutationRequest) {
		if (request.model === 'message') {
			return (await this.createMessage({
				type: String(request.data.type ?? 'message.created'),
				payload: (request.data.payload as Record<string, unknown> | undefined) ?? request.data,
				relatedModel: typeof request.data.relatedModel === 'string' ? request.data.relatedModel : null,
				relatedId: typeof request.data.relatedId === 'string' ? request.data.relatedId : null,
				priority: Number(request.data.priority ?? 0),
				maxAttempts: Number(request.data.maxAttempts ?? 3),
				actor: request.actor,
			})) as Record<string, unknown>;
		}
		if (request.model === 'subscription') {
			return (await this.subscriptions.create(request)) as Record<string, unknown>;
		}
		if (request.model === 'agent_run') {
			return (await this.runs.record({ run: request.data })) as Record<string, unknown>;
		}
		if (request.model === 'agent_cursor') {
			return (await this.cursors.update({
				...request,
				model: 'agent_cursor',
			})) as Record<string, unknown>;
		}
		if (request.model === 'content_lease') {
			return (await this.leases.update({
				...request,
				model: 'content_lease',
			})) as Record<string, unknown>;
		}
		throw new Error(`Unsupported D1 create model "${request.model}".`);
	}

	async update(request: SdkUpdateRequest) {
		if (request.model === 'message') {
			return this.messages.update(request) as Promise<Record<string, unknown> | null>;
		}
		if (request.model === 'subscription') {
			return this.subscriptions.update(request) as Promise<Record<string, unknown> | null>;
		}
		if (request.model === 'agent_run') {
			return this.runs.update(request) as Promise<Record<string, unknown> | null>;
		}
		if (request.model === 'agent_cursor') {
			return this.cursors.update(request) as Promise<Record<string, unknown> | null>;
		}
		if (request.model === 'content_lease') {
			return this.leases.update(request) as Promise<Record<string, unknown> | null>;
		}
		throw new Error(`Unsupported D1 update model "${request.model}".`);
	}

	claimMessage(request: SdkClaimMessageRequest) {
		return this.messages.claim(request);
	}

	ackMessage(request: SdkAckMessageRequest) {
		return this.messages.ack(request);
	}

	createMessage(request: SdkCreateMessageRequest) {
		return this.messages.create(request);
	}

	recordRun(request: SdkRecordRunRequest) {
		return this.runs.record(request);
	}

	getCursor(request: SdkGetCursorRequest) {
		return this.cursors.get(request);
	}

	upsertCursor(request: SdkCursorRequest) {
		return this.cursors.upsert(request);
	}

	releaseLease(request: SdkLeaseReleaseRequest) {
		return this.leases.release(request);
	}

	tryClaimContentLease(input: TryClaimContentLeaseInput) {
		return this.leases.tryClaim(input);
	}

	releaseAllLeases() {
		return this.leases.releaseAll();
	}
}
