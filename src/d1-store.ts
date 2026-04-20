import crypto from 'node:crypto';
import type { ContentLeaseRecord } from './types/agents.ts';
import type { D1DatabaseLike } from './types/cloudflare.ts';
import type {
	ReleaseDetail,
	ReleaseSummary,
	SharePackageStatus,
	WorkstreamDetail,
	WorkstreamEvent,
	WorkstreamSummary,
} from './knowledge-coop.ts';
import { applyFilters, applySort } from './sdk-filters.ts';
import { normalizeFilterFields, normalizeMutationData, normalizeRecordToCanonicalShape, normalizeSortFields } from './sdk-fields.ts';
import { assertExpectedVersion } from './sdk-version.ts';
import { resolveModelDefinition } from './model-registry.ts';
import type {
	SdkAppendTaskEventRequest,
	SdkAckMessageRequest,
	SdkClaimMessageRequest,
	SdkClaimTaskRequest,
	SdkCloseWorkDayRequest,
	SdkCompleteTaskRequest,
	SdkCreateReportRequest,
	SdkCreateMessageRequest,
	SdkCreatePrioritySnapshotRequest,
	SdkCreateTaskRequest,
	SdkCursorEntity,
	SdkCursorRequest,
	SdkFailTaskRequest,
	SdkFilterCondition,
	SdkFollowRequest,
	SdkGraphRunEntity,
	SdkGetRequest,
	SdkGetCursorRequest,
	SdkLeaseEntity,
	SdkLeaseReleaseRequest,
	SdkManagerContextPayload,
	SdkMessageEntity,
	SdkMutationRequest,
	SdkPickRequest,
	SdkPickResult,
	SdkPriorityOverrideRequest,
	SdkRecordRunRequest,
	SdkRecordScaleDecisionRequest,
	SdkRecordTaskCreditsRequest,
	SdkReportEntity,
	SdkRunEntity,
	SdkSearchRequest,
	SdkStartWorkDayRequest,
	SdkSubscriptionEntity,
	SdkTaskEntity,
	SdkTaskSearchRequest,
	SdkUpsertWorkPolicyRequest,
	SdkTaskProgressRequest,
	SdkUpdateRequest,
	SdkWorkDayEntity,
	ScaleDecision,
	TaskCreditLedgerEntry,
	WorkdayPolicy,
	PrioritySnapshot,
} from './sdk-types.ts';
import { CursorStore } from './stores/cursor-store.ts';
import { MemoryKnowledgeCoopStore, SqliteKnowledgeCoopStore } from './stores/knowledge-coop-store.ts';
import { LeaseStore, type LeaseClaimInput } from './stores/lease-store.ts';
import { MessageStore } from './stores/message-store.ts';
import { OperationalStore } from './stores/operational-store.ts';
import { RunStore } from './stores/run-store.ts';
import { SubscriptionStore } from './stores/subscription-store.ts';

export interface TryClaimContentLeaseInput extends LeaseClaimInput {}

type D1Record =
	| SdkSubscriptionEntity
	| SdkMessageEntity
	| SdkRunEntity
	| SdkCursorEntity
	| SdkLeaseEntity
	| SdkWorkDayEntity
	| SdkTaskEntity
	| SdkGraphRunEntity
	| SdkReportEntity;

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
	startWorkDay(request: SdkStartWorkDayRequest): Promise<SdkWorkDayEntity | null>;
	closeWorkDay(request: SdkCloseWorkDayRequest): Promise<SdkWorkDayEntity | null>;
	createTask(request: SdkCreateTaskRequest): Promise<SdkTaskEntity | null>;
	claimTask(request: SdkClaimTaskRequest): Promise<SdkTaskEntity | null>;
	recordTaskProgress(request: SdkTaskProgressRequest): Promise<SdkTaskEntity | null>;
	completeTask(request: SdkCompleteTaskRequest): Promise<SdkTaskEntity | null>;
	failTask(request: SdkFailTaskRequest): Promise<SdkTaskEntity | null>;
	appendTaskEvent(request: SdkAppendTaskEventRequest): Promise<Record<string, unknown> | null>;
	searchTasks(request: SdkTaskSearchRequest): Promise<SdkTaskEntity[]>;
	createReport(request: SdkCreateReportRequest): Promise<SdkReportEntity | null>;
	getManagerContext(taskId: string): Promise<SdkManagerContextPayload>;
	getWorkPolicy(projectId: string, environment?: string): Promise<WorkdayPolicy | null>;
	upsertWorkPolicy(request: SdkUpsertWorkPolicyRequest): Promise<WorkdayPolicy | null>;
	listPriorityOverrides(projectId: string): Promise<Record<string, unknown>[]>;
	upsertPriorityOverride(request: SdkPriorityOverrideRequest): Promise<Record<string, unknown> | null>;
	createPrioritySnapshot(request: SdkCreatePrioritySnapshotRequest): Promise<PrioritySnapshot | null>;
	getLatestPrioritySnapshot(projectId: string, workDayId?: string | null): Promise<PrioritySnapshot | null>;
	recordTaskCredits(request: SdkRecordTaskCreditsRequest): Promise<TaskCreditLedgerEntry | null>;
	listTaskCredits(workDayId: string): Promise<TaskCreditLedgerEntry[]>;
	recordScaleDecision(request: SdkRecordScaleDecisionRequest): Promise<ScaleDecision | null>;
	getLatestScaleDecision(projectId: string, environment: string, poolName: string): Promise<ScaleDecision | null>;
	listWorkstreams(projectId: string): Promise<WorkstreamSummary[]>;
	getWorkstream(workstreamId: string): Promise<WorkstreamDetail | null>;
	upsertWorkstream(input: Partial<WorkstreamSummary> & Pick<WorkstreamSummary, 'projectId' | 'title'>): Promise<WorkstreamSummary | null>;
	appendWorkstreamEvent(input: Pick<WorkstreamEvent, 'projectId' | 'workstreamId' | 'kind'> & Partial<WorkstreamEvent>): Promise<WorkstreamEvent | null>;
	listReleases(projectId: string): Promise<ReleaseSummary[]>;
	getRelease(releaseId: string): Promise<ReleaseDetail | null>;
	upsertRelease(input: Partial<ReleaseSummary> & Pick<ReleaseSummary, 'projectId' | 'version'> & { items?: ReleaseDetail['items'] }): Promise<ReleaseDetail | null>;
	listSharePackages(projectId: string): Promise<SharePackageStatus[]>;
	getSharePackage(packageId: string): Promise<SharePackageStatus | null>;
	upsertSharePackage(input: Partial<SharePackageStatus> & Pick<SharePackageStatus, 'projectId' | 'kind' | 'title'>): Promise<SharePackageStatus | null>;
}

function nowIso() {
	return new Date().toISOString();
}

function nextLeaseToken() {
	return crypto.randomUUID();
}

function pickSortForRequest(request: SdkPickRequest, defaultField: string) {
	switch (request.strategy) {
		case 'oldest':
			return [{ field: defaultField, direction: 'asc' as const }];
		case 'highest_priority':
		case 'latest':
		default:
			return [{ field: defaultField, direction: 'desc' as const }];
	}
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
	private readonly workDays = new Map<string, SdkWorkDayEntity>();
	private readonly tasks = new Map<string, SdkTaskEntity>();
	private readonly taskEvents = new Map<string, Record<string, unknown>[]>();
	private readonly taskOutputs = new Map<string, Record<string, unknown>[]>();
	private readonly graphRuns = new Map<string, SdkGraphRunEntity>();
	private readonly reports = new Map<string, SdkReportEntity>();
	private readonly workPolicies = new Map<string, WorkdayPolicy>();
	private readonly priorityOverrides = new Map<string, Record<string, unknown>>();
	private readonly prioritySnapshots = new Map<string, PrioritySnapshot>();
	private readonly taskCreditLedger = new Map<string, TaskCreditLedgerEntry>();
	private readonly scaleDecisions = new Map<string, ScaleDecision>();
	private readonly knowledgeCoop = new MemoryKnowledgeCoopStore();
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
		if (model === 'work_day') {
			return [...this.workDays.values()];
		}
		if (model === 'task') {
			return [...this.tasks.values()];
		}
		if (model === 'graph_run') {
			return [...this.graphRuns.values()];
		}
		if (model === 'report') {
			return [...this.reports.values()];
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
		if (request.model === 'work_day') {
			return this.workDays.get(key) ?? null;
		}
		if (request.model === 'task') {
			return this.tasks.get(key) ?? null;
		}
		if (request.model === 'graph_run') {
			return this.graphRuns.get(key) ?? null;
		}
		if (request.model === 'report') {
			return this.reports.get(key) ?? null;
		}
		return (
			this.rowsForModel(request.model).find((row) =>
				[row.id, row.email, row.runId].map((value) => String(value ?? '')).includes(key),
			) ?? null
		) as Record<string, unknown> | null;
	}

	async search(request: SdkSearchRequest) {
		const definition = resolveModelDefinition(request.model);
		const rows = this.rowsForModel(request.model).map((row) =>
			normalizeRecordToCanonicalShape(definition, row as Record<string, unknown>),
		);
		const filtered = applyFilters(rows as Record<string, unknown>[], normalizeFilterFields(definition, request.filters), definition);
		const sorted = applySort(filtered as Record<string, unknown>[], normalizeSortFields(definition, request.sort), definition);
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
			const candidates = [...this.messages.values()]
				.filter((message) =>
					(message.status === 'pending' || message.status === 'failed')
					&& new Date(message.availableAt).valueOf() <= Date.now()
					&& (!request.filters
						?.filter((filter) => filter.field === 'type' && filter.op === 'in')
						.flatMap((filter) => (Array.isArray(filter.value) ? filter.value.map(String) : []))
						.length
						|| request.filters
							.filter((filter) => filter.field === 'type' && filter.op === 'in')
							.flatMap((filter) => (Array.isArray(filter.value) ? filter.value.map(String) : []))
							.includes(message.type)),
				)
				.sort((left, right) => {
					if (request.strategy === 'oldest') {
						return left.availableAt.localeCompare(right.availableAt) || right.priority - left.priority;
					}
					if (request.strategy === 'latest') {
						return right.availableAt.localeCompare(left.availableAt) || right.priority - left.priority;
					}
					return right.priority - left.priority || left.availableAt.localeCompare(right.availableAt);
				});
			const pending = candidates[0];
			if (!pending) {
				return { item: null, leaseToken: null };
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
			return {
				item: next as Record<string, unknown>,
				leaseToken: nextLeaseToken(),
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
			sort: pickSortForRequest(request, filterSinceField(request.model)),
		});
		return {
			item: items[0] ?? null,
			leaseToken: null,
		};
	}

	async create(request: SdkMutationRequest) {
		const definition = resolveModelDefinition(request.model);
		const data = normalizeMutationData(definition, request.data);
		switch (request.model) {
			case 'message':
				return (await this.createMessage({
					type: String(data.type ?? 'message.created'),
					payload: (data.payload as Record<string, unknown> | undefined) ?? data,
					relatedModel: typeof data.related_model === 'string' ? data.related_model : null,
					relatedId: typeof data.related_id === 'string' ? data.related_id : null,
					priority: Number(data.priority ?? 0),
					maxAttempts: Number(data.maxAttempts ?? 3),
					actor: request.actor,
				})) as Record<string, unknown>;
			case 'subscription': {
				const record: SdkSubscriptionEntity = {
					id: this.subscriptions.size + 1,
					email: String(data.email ?? ''),
					name: data.name ? String(data.name) : null,
					status: String(data.status ?? 'active'),
					source: String(data.source ?? 'sdk'),
					consent_at: String(data.consent_at ?? nowIso()),
					created_at: String(data.created_at ?? nowIso()),
					updated_at: String(data.updated_at ?? nowIso()),
					ip_hash: String(data.ip_hash ?? ''),
				};
				this.subscriptions.set(String(record.id), record);
				return record;
			}
			case 'agent_run':
				return this.recordRun({ run: data });
			case 'agent_cursor': {
				const agentSlug = String(data.agent_slug ?? '');
				const cursorKey = String(data.cursor_key ?? '');
				const cursorValue = String(data.cursor_value ?? '');
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
					model: String(data.model ?? ''),
					itemKey: String(data.item_key ?? ''),
					claimedBy: String(data.claimed_by ?? request.actor),
					leaseSeconds: Number(data.leaseSeconds ?? 300),
				});
				const lease = this.contentLeases.get(`${data.model}:${data.item_key}`);
				return {
					model: String(data.model ?? ''),
					itemKey: String(data.item_key ?? ''),
					claimedBy: String(data.claimed_by ?? request.actor),
					claimedAt: String(lease?.claimedAt ?? nowIso()),
					leaseExpiresAt: String(lease?.leaseExpiresAt ?? nowIso()),
					token: String(token ?? lease?.token ?? ''),
				};
			}
			case 'work_day':
				return this.startWorkDay({
					id: typeof data.id === 'string' ? data.id : undefined,
					projectId: String(data.projectId ?? data.project_id ?? ''),
					capacityBudget: Number(data.capacityBudget ?? data.capacity_budget ?? 0),
					graphVersion: typeof (data.graphVersion ?? data.graph_version) === 'string' ? String(data.graphVersion ?? data.graph_version) : null,
					summary: (data.summary as Record<string, unknown> | null | undefined) ?? null,
					actor: request.actor,
				});
			case 'task':
				return this.createTask({
					id: typeof data.id === 'string' ? data.id : undefined,
					workDayId: String(data.workDayId ?? data.work_day_id ?? ''),
					agentId: String(data.agentId ?? data.agent_id ?? ''),
					type: String(data.type ?? ''),
					state: typeof data.state === 'string' ? data.state : 'pending',
					priority: Number(data.priority ?? 0),
					idempotencyKey: String(data.idempotencyKey ?? data.idempotency_key ?? ''),
					payload: ((data.payload as Record<string, unknown> | undefined) ?? data) as Record<string, unknown>,
					payloadHash: typeof (data.payloadHash ?? data.payload_hash) === 'string' ? String(data.payloadHash ?? data.payload_hash) : null,
					maxAttempts: Number(data.maxAttempts ?? data.max_attempts ?? 3),
					availableAt: typeof (data.availableAt ?? data.available_at) === 'string' ? String(data.availableAt ?? data.available_at) : undefined,
					graphVersion: typeof (data.graphVersion ?? data.graph_version) === 'string' ? String(data.graphVersion ?? data.graph_version) : null,
					parentTaskId: typeof (data.parentTaskId ?? data.parent_task_id) === 'string' ? String(data.parentTaskId ?? data.parent_task_id) : null,
					actor: request.actor,
				});
			case 'graph_run': {
				const record: SdkGraphRunEntity = {
					id: String(data.id ?? crypto.randomUUID()),
					workDayId: String(data.workDayId ?? data.work_day_id ?? ''),
					corpusHash: String(data.corpusHash ?? data.corpus_hash ?? ''),
					graphVersion: String(data.graphVersion ?? data.graph_version ?? ''),
					queryJson: typeof (data.queryJson ?? data.query_json) === 'string' ? String(data.queryJson ?? data.query_json) : null,
					seedIdsJson: typeof (data.seedIdsJson ?? data.seed_ids_json) === 'string' ? String(data.seedIdsJson ?? data.seed_ids_json) : null,
					selectedNodeIdsJson: typeof (data.selectedNodeIdsJson ?? data.selected_node_ids_json) === 'string' ? String(data.selectedNodeIdsJson ?? data.selected_node_ids_json) : null,
					statsJson: typeof (data.statsJson ?? data.stats_json) === 'string' ? String(data.statsJson ?? data.stats_json) : null,
					snapshotRef: typeof (data.snapshotRef ?? data.snapshot_ref) === 'string' ? String(data.snapshotRef ?? data.snapshot_ref) : null,
					createdAt: String(data.createdAt ?? data.created_at ?? nowIso()),
				};
				this.graphRuns.set(record.id, record);
				return record;
			}
			case 'report':
				return this.createReport({
					id: typeof data.id === 'string' ? data.id : undefined,
					workDayId: String(data.workDayId ?? data.work_day_id ?? ''),
					kind: String(data.kind ?? 'workday_summary'),
					body: ((data.body as Record<string, unknown> | undefined) ?? data) as Record<string, unknown>,
					renderedRef: typeof (data.renderedRef ?? data.rendered_ref) === 'string' ? String(data.renderedRef ?? data.rendered_ref) : null,
					sentAt: typeof (data.sentAt ?? data.sent_at) === 'string' ? String(data.sentAt ?? data.sent_at) : null,
					actor: request.actor,
				});
			default:
				throw new Error(`Unsupported D1 create model "${request.model}".`);
		}
	}

	async update(request: SdkUpdateRequest) {
		const definition = resolveModelDefinition(request.model);
		const data = normalizeMutationData(definition, request.data);
		switch (request.model) {
			case 'message': {
				const current = this.messages.get(Number(request.id ?? request.key ?? data.id ?? 0));
				if (!current) {
					return null;
				}
				assertExpectedVersion(request.expectedVersion, current, `message ${current.id}`);
				const next = {
					...current,
					...data,
					updatedAt: nowIso(),
				} as SdkMessageEntity;
				this.messages.set(next.id, next);
				return next;
			}
			case 'subscription': {
				const key = String(request.id ?? request.key ?? data.email ?? '');
				const current = (await this.get({ model: 'subscription', key })) as SdkSubscriptionEntity | null;
				if (!current) {
					return null;
				}
				assertExpectedVersion(request.expectedVersion, current, `subscription "${current.email}"`);
				const next = {
					...current,
					...data,
					updated_at: nowIso(),
				};
				this.subscriptions.set(String(next.id ?? next.email), next);
				return next;
			}
			case 'agent_run':
				assertExpectedVersion(
					request.expectedVersion,
					(await this.get({ model: 'agent_run', key: String(request.id ?? request.key ?? data.run_id ?? '') })) as Record<string, unknown> | null,
					`agent_run "${String(request.id ?? request.key ?? data.run_id ?? '')}"`,
				);
				return this.recordRun({ run: { ...data, runId: request.id ?? request.key ?? data.run_id } });
			case 'agent_cursor':
				assertExpectedVersion(
					request.expectedVersion,
					(await this.get({
						model: 'agent_cursor',
						key: `${String(data.agent_slug ?? request.id ?? request.key ?? '')}:${String(data.cursor_key ?? request.slug ?? '')}`,
					})) as Record<string, unknown> | null,
					`agent_cursor "${String(data.agent_slug ?? request.id ?? request.key ?? '')}:${String(data.cursor_key ?? request.slug ?? '')}"`,
				);
				return this.create({
					model: 'agent_cursor',
					data,
					actor: request.actor,
				});
			case 'content_lease':
				assertExpectedVersion(
					request.expectedVersion,
					(await this.get({
						model: 'content_lease',
						key: `${String(data.model ?? request.id ?? '')}:${String(data.item_key ?? request.slug ?? request.key ?? '')}`,
					})) as Record<string, unknown> | null,
					`content_lease "${String(data.model ?? request.id ?? '')}:${String(data.item_key ?? request.slug ?? request.key ?? '')}"`,
				);
				return this.create({
					model: 'content_lease',
					data,
					actor: request.actor,
				});
			case 'work_day':
				return this.closeWorkDay({
					id: String(request.id ?? request.key ?? data.id ?? ''),
					state: (data.state as 'completed' | 'cancelled' | 'failed' | undefined) ?? 'completed',
					summary: (data.summary as Record<string, unknown> | null | undefined) ?? null,
					actor: request.actor,
				});
			case 'task': {
				const taskId = String(request.id ?? request.key ?? data.id ?? '');
				if (data.state === 'completed') {
					return this.completeTask({
						id: taskId,
						output: (data.output as Record<string, unknown> | undefined) ?? null,
						outputRef: typeof data.outputRef === 'string' ? data.outputRef : null,
						summary: (data.summary as Record<string, unknown> | undefined) ?? null,
						actor: request.actor,
					});
				}
				if (data.state === 'failed') {
					return this.failTask({
						id: taskId,
						errorCode: typeof data.errorCode === 'string' ? data.errorCode : null,
						errorMessage: String(data.errorMessage ?? 'Task failed'),
						retryable: Boolean(data.retryable),
						nextVisibleAt: typeof data.nextVisibleAt === 'string' ? data.nextVisibleAt : null,
						actor: request.actor,
					});
				}
				return this.recordTaskProgress({
					id: taskId,
					workerId: typeof data.workerId === 'string' ? data.workerId : null,
					state: typeof data.state === 'string' ? data.state : undefined,
					appendEvent: data.appendEvent as { kind: string; data?: Record<string, unknown> } | null | undefined,
					patch: (data.patch as Record<string, unknown> | undefined) ?? undefined,
					actor: request.actor,
				});
			}
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

	async startWorkDay(request: SdkStartWorkDayRequest) {
		const timestamp = nowIso();
		const record: SdkWorkDayEntity = {
			id: request.id ?? crypto.randomUUID(),
			projectId: request.projectId,
			state: 'active',
			capacityBudget: Number(request.capacityBudget ?? 0),
			capacityUsed: 0,
			graphVersion: request.graphVersion ?? null,
			summaryJson: request.summary ? JSON.stringify(request.summary) : null,
			startedAt: timestamp,
			endedAt: null,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.workDays.set(record.id, record);
		return record;
	}

	async closeWorkDay(request: SdkCloseWorkDayRequest) {
		const existing = this.workDays.get(request.id);
		if (!existing) return null;
		const next: SdkWorkDayEntity = {
			...existing,
			state: request.state ?? 'completed',
			summaryJson: request.summary ? JSON.stringify(request.summary) : existing.summaryJson,
			endedAt: nowIso(),
			updatedAt: nowIso(),
		};
		this.workDays.set(next.id, next);
		return next;
	}

	async createTask(request: SdkCreateTaskRequest) {
		const timestamp = nowIso();
		const record: SdkTaskEntity = {
			id: request.id ?? crypto.randomUUID(),
			workDayId: request.workDayId,
			agentId: request.agentId,
			type: request.type,
			state: request.state ?? 'pending',
			priority: Number(request.priority ?? 0),
			idempotencyKey: request.idempotencyKey,
			payloadJson: JSON.stringify(request.payload),
			payloadHash: request.payloadHash ?? null,
			attemptCount: 0,
			maxAttempts: Number(request.maxAttempts ?? 3),
			claimedBy: null,
			leaseExpiresAt: null,
			availableAt: request.availableAt ?? timestamp,
			lastErrorCode: null,
			lastErrorMessage: null,
			graphVersion: request.graphVersion ?? null,
			parentTaskId: request.parentTaskId ?? null,
			createdAt: timestamp,
			startedAt: null,
			completedAt: null,
			updatedAt: timestamp,
		};
		this.tasks.set(record.id, record);
		return record;
	}

	async claimTask(request: SdkClaimTaskRequest) {
		const existing = this.tasks.get(request.id);
		if (!existing) return null;
		const next: SdkTaskEntity = {
			...existing,
			state: 'claimed',
			claimedBy: request.workerId,
			leaseExpiresAt: new Date(Date.now() + request.leaseSeconds * 1000).toISOString(),
			attemptCount: existing.attemptCount + 1,
			startedAt: existing.startedAt ?? nowIso(),
			updatedAt: nowIso(),
		};
		this.tasks.set(next.id, next);
		return next;
	}

	async recordTaskProgress(request: SdkTaskProgressRequest) {
		const existing = this.tasks.get(request.id);
		if (!existing) return null;
		const nextPayload = {
			...(JSON.parse(existing.payloadJson) as Record<string, unknown>),
			...(request.patch ?? {}),
		};
		const next: SdkTaskEntity = {
			...existing,
			state: request.state ?? existing.state,
			claimedBy: request.workerId ?? existing.claimedBy,
			payloadJson: JSON.stringify(nextPayload),
			updatedAt: nowIso(),
		};
		this.tasks.set(next.id, next);
		if (request.appendEvent?.kind) {
			await this.appendTaskEvent({
				taskId: request.id,
				kind: request.appendEvent.kind,
				data: request.appendEvent.data,
				actor: request.actor,
			});
		}
		return next;
	}

	async completeTask(request: SdkCompleteTaskRequest) {
		const existing = this.tasks.get(request.id);
		if (!existing) return null;
		const next: SdkTaskEntity = {
			...existing,
			state: 'completed',
			completedAt: nowIso(),
			leaseExpiresAt: null,
			updatedAt: nowIso(),
		};
		this.tasks.set(next.id, next);
		if (request.output) {
			const outputs = this.taskOutputs.get(request.id) ?? [];
			outputs.push({
				id: crypto.randomUUID(),
				taskId: request.id,
				outputJson: JSON.stringify(request.output),
				outputRef: request.outputRef ?? null,
				createdAt: nowIso(),
			});
			this.taskOutputs.set(request.id, outputs);
		}
		if (request.summary) {
			await this.appendTaskEvent({
				taskId: request.id,
				kind: 'completed',
				data: request.summary,
				actor: request.actor,
			});
		}
		return next;
	}

	async failTask(request: SdkFailTaskRequest) {
		const existing = this.tasks.get(request.id);
		if (!existing) return null;
		const next: SdkTaskEntity = {
			...existing,
			state: request.retryable ? 'pending' : 'failed',
			availableAt: request.nextVisibleAt ?? existing.availableAt,
			lastErrorCode: request.errorCode ?? null,
			lastErrorMessage: request.errorMessage,
			leaseExpiresAt: null,
			updatedAt: nowIso(),
		};
		this.tasks.set(next.id, next);
		return next;
	}

	async appendTaskEvent(request: SdkAppendTaskEventRequest) {
		const events = this.taskEvents.get(request.taskId) ?? [];
		const next = {
			id: crypto.randomUUID(),
			taskId: request.taskId,
			seq: events.length + 1,
			kind: request.kind,
			dataJson: JSON.stringify({ ...(request.data ?? {}), actor: request.actor }),
			createdAt: nowIso(),
		};
		events.push(next);
		this.taskEvents.set(request.taskId, events);
		return next;
	}

	async searchTasks(request: SdkTaskSearchRequest) {
		return [...this.tasks.values()]
			.filter((task) => !request.workDayId || task.workDayId === request.workDayId)
			.filter((task) => !request.agentId || task.agentId === request.agentId)
			.filter((task) => {
				if (!request.state) return true;
				const states = Array.isArray(request.state) ? request.state : [request.state];
				return states.includes(task.state);
			})
			.sort((left, right) => right.priority - left.priority || left.availableAt.localeCompare(right.availableAt))
			.slice(0, request.limit ?? 50);
	}

	async createReport(request: SdkCreateReportRequest) {
		const record: SdkReportEntity = {
			id: request.id ?? crypto.randomUUID(),
			workDayId: request.workDayId,
			kind: request.kind,
			bodyJson: JSON.stringify(request.body),
			renderedRef: request.renderedRef ?? null,
			sentAt: request.sentAt ?? null,
			createdAt: nowIso(),
		};
		this.reports.set(record.id, record);
		return record;
	}

	async getManagerContext(taskId: string) {
		const task = this.tasks.get(taskId) ?? null;
		const workDay = task ? (this.workDays.get(task.workDayId) ?? null) : null;
		return {
			task,
			workDay,
			agent: null,
			graph: workDay?.graphVersion ? { graphVersion: workDay.graphVersion } : null,
		};
	}

	async getWorkPolicy(projectId: string, environment: string = 'local') {
		return this.workPolicies.get(`${projectId}:${environment}`) ?? null;
	}

	async upsertWorkPolicy(request: SdkUpsertWorkPolicyRequest) {
		const policy: WorkdayPolicy = {
			projectId: request.projectId,
			environment: request.environment,
			schedule: request.schedule,
			dailyTaskCreditBudget: request.dailyTaskCreditBudget,
			maxQueuedTasks: request.maxQueuedTasks,
			maxQueuedCredits: request.maxQueuedCredits,
			autoscale: request.autoscale,
			creditWeights: request.creditWeights ?? [],
			metadata: request.metadata ?? {},
		};
		this.workPolicies.set(`${request.projectId}:${request.environment}`, policy);
		return policy;
	}

	async listPriorityOverrides(projectId: string) {
		return [...this.priorityOverrides.values()].filter((entry) => entry.projectId === projectId);
	}

	async upsertPriorityOverride(request: SdkPriorityOverrideRequest) {
		const record = {
			id: request.id ?? crypto.randomUUID(),
			projectId: request.projectId,
			model: request.model,
			subjectId: request.subjectId,
			priority: request.priority,
			estimatedCredits: request.estimatedCredits ?? null,
			metadata: request.metadata ?? {},
			createdAt: nowIso(),
			updatedAt: nowIso(),
		};
		this.priorityOverrides.set(record.id, record);
		return record;
	}

	async createPrioritySnapshot(request: SdkCreatePrioritySnapshotRequest) {
		const snapshot: PrioritySnapshot = {
			id: request.id ?? crypto.randomUUID(),
			projectId: request.projectId,
			workDayId: request.workDayId ?? null,
			generatedAt: nowIso(),
			items: request.items,
			metadata: request.metadata ?? {},
		};
		this.prioritySnapshots.set(snapshot.id, snapshot);
		return snapshot;
	}

	async getLatestPrioritySnapshot(projectId: string, workDayId?: string | null) {
		return [...this.prioritySnapshots.values()]
			.filter((entry) => entry.projectId === projectId)
			.filter((entry) => !workDayId || entry.workDayId === workDayId)
			.sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0] ?? null;
	}

	async recordTaskCredits(request: SdkRecordTaskCreditsRequest) {
		const entry: TaskCreditLedgerEntry = {
			id: request.id ?? crypto.randomUUID(),
			projectId: request.projectId,
			workDayId: request.workDayId,
			taskId: request.taskId ?? null,
			phase: request.phase,
			credits: request.credits,
			metadata: request.metadata ?? {},
			createdAt: nowIso(),
		};
		this.taskCreditLedger.set(entry.id, entry);
		const workDay = this.workDays.get(request.workDayId);
		if (workDay) {
			const delta = request.phase === 'refund' ? -Math.abs(request.credits) : Math.abs(request.credits);
			this.workDays.set(workDay.id, {
				...workDay,
				capacityUsed: Math.max(0, workDay.capacityUsed + delta),
				updatedAt: nowIso(),
			});
		}
		return entry;
	}

	async listTaskCredits(workDayId: string) {
		return [...this.taskCreditLedger.values()]
			.filter((entry) => entry.workDayId === workDayId)
			.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
	}

	async recordScaleDecision(request: SdkRecordScaleDecisionRequest) {
		const decision: ScaleDecision = {
			id: request.id ?? crypto.randomUUID(),
			projectId: request.projectId,
			environment: request.environment,
			poolName: request.poolName,
			workDayId: request.workDayId ?? null,
			desiredWorkers: request.desiredWorkers,
			observedQueueDepth: request.observedQueueDepth,
			observedActiveLeases: request.observedActiveLeases,
			reason: request.reason,
			metadata: request.metadata ?? {},
			createdAt: nowIso(),
		};
		this.scaleDecisions.set(decision.id, decision);
		return decision;
	}

	async getLatestScaleDecision(projectId: string, environment: string, poolName: string) {
		return [...this.scaleDecisions.values()]
			.filter((entry) => entry.projectId === projectId && entry.environment === environment && entry.poolName === poolName)
			.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
	}

	listWorkstreams(projectId: string) {
		return Promise.resolve(this.knowledgeCoop.listWorkstreams(projectId));
	}

	getWorkstream(workstreamId: string) {
		return Promise.resolve(this.knowledgeCoop.getWorkstream(workstreamId));
	}

	upsertWorkstream(input: Partial<WorkstreamSummary> & Pick<WorkstreamSummary, 'projectId' | 'title'>) {
		return Promise.resolve(this.knowledgeCoop.upsertWorkstream(input));
	}

	appendWorkstreamEvent(input: Pick<WorkstreamEvent, 'projectId' | 'workstreamId' | 'kind'> & Partial<WorkstreamEvent>) {
		return Promise.resolve(this.knowledgeCoop.appendWorkstreamEvent(input));
	}

	listReleases(projectId: string) {
		return Promise.resolve(this.knowledgeCoop.listReleases(projectId));
	}

	getRelease(releaseId: string) {
		return Promise.resolve(this.knowledgeCoop.getRelease(releaseId));
	}

	upsertRelease(input: Partial<ReleaseSummary> & Pick<ReleaseSummary, 'projectId' | 'version'> & { items?: ReleaseDetail['items'] }): Promise<ReleaseDetail | null> {
		return Promise.resolve(this.knowledgeCoop.upsertRelease(input));
	}

	listSharePackages(projectId: string) {
		return Promise.resolve(this.knowledgeCoop.listSharePackages(projectId));
	}

	getSharePackage(packageId: string) {
		return Promise.resolve(this.knowledgeCoop.getSharePackage(packageId));
	}

	upsertSharePackage(input: Partial<SharePackageStatus> & Pick<SharePackageStatus, 'projectId' | 'kind' | 'title'>) {
		return Promise.resolve(this.knowledgeCoop.upsertSharePackage(input));
	}
}

export class CloudflareD1AgentDatabase implements AgentDatabase {
	private readonly subscriptions: SubscriptionStore;
	private readonly messages: MessageStore;
	private readonly runs: RunStore;
	private readonly cursors: CursorStore;
	private readonly leases: LeaseStore;
	private readonly operational: OperationalStore;
	private readonly knowledgeCoop: SqliteKnowledgeCoopStore;

	constructor(readonly db: D1DatabaseLike) {
		this.subscriptions = new SubscriptionStore(db);
		this.messages = new MessageStore(db);
		this.runs = new RunStore(db);
		this.cursors = new CursorStore(db);
		this.leases = new LeaseStore(db);
		this.operational = new OperationalStore(db);
		this.knowledgeCoop = new SqliteKnowledgeCoopStore(db);
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
		if (request.model === 'work_day') {
			return this.operational.getWorkDay(String(request.id ?? request.key ?? request.slug ?? '')) as Promise<Record<string, unknown> | null>;
		}
		if (request.model === 'task') {
			return this.operational.getTask(String(request.id ?? request.key ?? request.slug ?? '')) as Promise<Record<string, unknown> | null>;
		}
		if (request.model === 'report') {
			return this.operational.getReport(String(request.id ?? request.key ?? request.slug ?? '')) as Promise<Record<string, unknown> | null>;
		}
		throw new Error(`Unsupported D1 get model "${request.model}".`);
	}

	async search(request: SdkSearchRequest) {
		const definition = resolveModelDefinition(request.model);
		const normalizedRequest = {
			...request,
			filters: normalizeFilterFields(definition, request.filters),
			sort: normalizeSortFields(definition, request.sort),
		};
		if (request.model === 'subscription') {
			return this.subscriptions.search(normalizedRequest) as Promise<Record<string, unknown>[]>;
		}
		if (request.model === 'message') {
			return this.messages.search(normalizedRequest) as Promise<Record<string, unknown>[]>;
		}
		if (request.model === 'agent_run') {
			return this.runs.search(normalizedRequest) as Promise<Record<string, unknown>[]>;
		}
		if (request.model === 'agent_cursor') {
			return this.cursors.search(normalizedRequest) as Promise<Record<string, unknown>[]>;
		}
		if (request.model === 'content_lease') {
			return this.leases.search(normalizedRequest) as Promise<Record<string, unknown>[]>;
		}
		if (request.model === 'work_day') {
			return this.operational.searchWorkDays(request.limit) as Promise<Record<string, unknown>[]>;
		}
		if (request.model === 'task') {
			return this.operational.searchTasks({
				workDayId: request.filters?.find((entry) => entry.field === 'workDayId' || entry.field === 'work_day_id')?.value as string | undefined,
				agentId: request.filters?.find((entry) => entry.field === 'agentId' || entry.field === 'agent_id')?.value as string | undefined,
				state: request.filters?.find((entry) => entry.field === 'state')?.value as string | string[] | undefined,
				limit: request.limit,
			}) as Promise<Record<string, unknown>[]>;
		}
		if (request.model === 'report') {
			return [] as Record<string, unknown>[];
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
			}, request.strategy);
			return {
				item: claimed as Record<string, unknown> | null,
				leaseToken: claimed ? nextLeaseToken() : null,
			};
		}
		if (request.model === 'content_lease') {
			const items = await this.leases.search({
				model: 'content_lease',
				filters: request.filters,
				sort: pickSortForRequest(request, 'lease_expires_at'),
				limit: 1,
			});
			return {
				item: (items[0] ?? null) as Record<string, unknown> | null,
				leaseToken: items[0]?.token ?? null,
			};
		}
		if (request.model === 'task') {
			const items = await this.operational.searchTasks({
				state: 'pending',
				limit: 1,
			});
			return { item: (items[0] ?? null) as Record<string, unknown> | null, leaseToken: null };
		}
		return {
			item: (
				await this.search({
					model: request.model,
					filters: request.filters,
					sort: pickSortForRequest(request, filterSinceField(request.model)),
					limit: 1,
				})
			)[0] ?? null,
			leaseToken: null,
		};
	}

	async create(request: SdkMutationRequest) {
		const definition = resolveModelDefinition(request.model);
		const normalizedRequest = {
			...request,
			data: normalizeMutationData(definition, request.data),
		};
		if (request.model === 'message') {
			return (await this.createMessage({
				type: String(normalizedRequest.data.type ?? 'message.created'),
				payload: (normalizedRequest.data.payload as Record<string, unknown> | undefined) ?? normalizedRequest.data,
				relatedModel: typeof normalizedRequest.data.related_model === 'string' ? normalizedRequest.data.related_model : null,
				relatedId: typeof normalizedRequest.data.related_id === 'string' ? normalizedRequest.data.related_id : null,
				priority: Number(normalizedRequest.data.priority ?? 0),
				maxAttempts: Number(normalizedRequest.data.maxAttempts ?? 3),
				actor: request.actor,
			})) as Record<string, unknown>;
		}
		if (request.model === 'subscription') {
			return (await this.subscriptions.create(normalizedRequest)) as Record<string, unknown>;
		}
		if (request.model === 'agent_run') {
			return (await this.runs.record({ run: normalizedRequest.data })) as Record<string, unknown>;
		}
		if (request.model === 'agent_cursor') {
			return (await this.cursors.update({
				...normalizedRequest,
				model: 'agent_cursor',
			})) as Record<string, unknown>;
		}
		if (request.model === 'content_lease') {
			return (await this.leases.update({
				...normalizedRequest,
				model: 'content_lease',
			})) as Record<string, unknown>;
		}
		if (request.model === 'work_day') {
			return (await this.startWorkDay({
				id: typeof normalizedRequest.data.id === 'string' ? normalizedRequest.data.id : undefined,
				projectId: String(normalizedRequest.data.projectId ?? normalizedRequest.data.project_id ?? ''),
				capacityBudget: Number(normalizedRequest.data.capacityBudget ?? normalizedRequest.data.capacity_budget ?? 0),
				graphVersion: typeof (normalizedRequest.data.graphVersion ?? normalizedRequest.data.graph_version) === 'string' ? String(normalizedRequest.data.graphVersion ?? normalizedRequest.data.graph_version) : null,
				summary: normalizedRequest.data.summary as Record<string, unknown> | null | undefined,
				actor: request.actor,
			})) as Record<string, unknown>;
		}
		if (request.model === 'task') {
			return (await this.createTask({
				id: typeof normalizedRequest.data.id === 'string' ? normalizedRequest.data.id : undefined,
				workDayId: String(normalizedRequest.data.workDayId ?? normalizedRequest.data.work_day_id ?? ''),
				agentId: String(normalizedRequest.data.agentId ?? normalizedRequest.data.agent_id ?? ''),
				type: String(normalizedRequest.data.type ?? ''),
				state: typeof normalizedRequest.data.state === 'string' ? normalizedRequest.data.state : 'pending',
				priority: Number(normalizedRequest.data.priority ?? 0),
				idempotencyKey: String(normalizedRequest.data.idempotencyKey ?? normalizedRequest.data.idempotency_key ?? ''),
				payload: ((normalizedRequest.data.payload as Record<string, unknown> | undefined) ?? normalizedRequest.data) as Record<string, unknown>,
				payloadHash: typeof (normalizedRequest.data.payloadHash ?? normalizedRequest.data.payload_hash) === 'string' ? String(normalizedRequest.data.payloadHash ?? normalizedRequest.data.payload_hash) : null,
				maxAttempts: Number(normalizedRequest.data.maxAttempts ?? normalizedRequest.data.max_attempts ?? 3),
				availableAt: typeof (normalizedRequest.data.availableAt ?? normalizedRequest.data.available_at) === 'string' ? String(normalizedRequest.data.availableAt ?? normalizedRequest.data.available_at) : undefined,
				graphVersion: typeof (normalizedRequest.data.graphVersion ?? normalizedRequest.data.graph_version) === 'string' ? String(normalizedRequest.data.graphVersion ?? normalizedRequest.data.graph_version) : null,
				parentTaskId: typeof (normalizedRequest.data.parentTaskId ?? normalizedRequest.data.parent_task_id) === 'string' ? String(normalizedRequest.data.parentTaskId ?? normalizedRequest.data.parent_task_id) : null,
				actor: request.actor,
			})) as Record<string, unknown>;
		}
		if (request.model === 'graph_run') {
			return (await this.operational.createGraphRun({
				id: String(normalizedRequest.data.id ?? crypto.randomUUID()),
				workDayId: String(normalizedRequest.data.workDayId ?? normalizedRequest.data.work_day_id ?? ''),
				corpusHash: String(normalizedRequest.data.corpusHash ?? normalizedRequest.data.corpus_hash ?? ''),
				graphVersion: String(normalizedRequest.data.graphVersion ?? normalizedRequest.data.graph_version ?? ''),
				queryJson: typeof (normalizedRequest.data.queryJson ?? normalizedRequest.data.query_json) === 'string' ? String(normalizedRequest.data.queryJson ?? normalizedRequest.data.query_json) : null,
				seedIdsJson: typeof (normalizedRequest.data.seedIdsJson ?? normalizedRequest.data.seed_ids_json) === 'string' ? String(normalizedRequest.data.seedIdsJson ?? normalizedRequest.data.seed_ids_json) : null,
				selectedNodeIdsJson: typeof (normalizedRequest.data.selectedNodeIdsJson ?? normalizedRequest.data.selected_node_ids_json) === 'string' ? String(normalizedRequest.data.selectedNodeIdsJson ?? normalizedRequest.data.selected_node_ids_json) : null,
				statsJson: typeof (normalizedRequest.data.statsJson ?? normalizedRequest.data.stats_json) === 'string' ? String(normalizedRequest.data.statsJson ?? normalizedRequest.data.stats_json) : null,
				snapshotRef: typeof (normalizedRequest.data.snapshotRef ?? normalizedRequest.data.snapshot_ref) === 'string' ? String(normalizedRequest.data.snapshotRef ?? normalizedRequest.data.snapshot_ref) : null,
				createdAt: typeof (normalizedRequest.data.createdAt ?? normalizedRequest.data.created_at) === 'string' ? String(normalizedRequest.data.createdAt ?? normalizedRequest.data.created_at) : undefined,
			})) as Record<string, unknown>;
		}
		if (request.model === 'report') {
			return (await this.createReport({
				id: typeof normalizedRequest.data.id === 'string' ? normalizedRequest.data.id : undefined,
				workDayId: String(normalizedRequest.data.workDayId ?? normalizedRequest.data.work_day_id ?? ''),
				kind: String(normalizedRequest.data.kind ?? 'workday_summary'),
				body: ((normalizedRequest.data.body as Record<string, unknown> | undefined) ?? normalizedRequest.data) as Record<string, unknown>,
				renderedRef: typeof (normalizedRequest.data.renderedRef ?? normalizedRequest.data.rendered_ref) === 'string' ? String(normalizedRequest.data.renderedRef ?? normalizedRequest.data.rendered_ref) : null,
				sentAt: typeof (normalizedRequest.data.sentAt ?? normalizedRequest.data.sent_at) === 'string' ? String(normalizedRequest.data.sentAt ?? normalizedRequest.data.sent_at) : null,
				actor: request.actor,
			})) as Record<string, unknown>;
		}
		throw new Error(`Unsupported D1 create model "${request.model}".`);
	}

	async update(request: SdkUpdateRequest) {
		const definition = resolveModelDefinition(request.model);
		const normalizedRequest = {
			...request,
			data: normalizeMutationData(definition, request.data),
		};
		if (request.model === 'message') {
			return this.messages.update(normalizedRequest) as Promise<Record<string, unknown> | null>;
		}
		if (request.model === 'subscription') {
			return this.subscriptions.update(normalizedRequest) as Promise<Record<string, unknown> | null>;
		}
		if (request.model === 'agent_run') {
			return this.runs.update(normalizedRequest) as Promise<Record<string, unknown> | null>;
		}
		if (request.model === 'agent_cursor') {
			return this.cursors.update(normalizedRequest) as Promise<Record<string, unknown> | null>;
		}
		if (request.model === 'content_lease') {
			return this.leases.update(normalizedRequest) as Promise<Record<string, unknown> | null>;
		}
		if (request.model === 'work_day') {
			return this.closeWorkDay({
				id: String(request.id ?? request.key ?? normalizedRequest.data.id ?? ''),
				state: (normalizedRequest.data.state as 'completed' | 'cancelled' | 'failed' | undefined) ?? 'completed',
				summary: normalizedRequest.data.summary as Record<string, unknown> | null | undefined,
				actor: request.actor,
			}) as Promise<Record<string, unknown> | null>;
		}
		if (request.model === 'task') {
			const taskId = String(request.id ?? request.key ?? normalizedRequest.data.id ?? '');
			if (normalizedRequest.data.state === 'completed') {
				return this.completeTask({
					id: taskId,
					output: normalizedRequest.data.output as Record<string, unknown> | null | undefined,
					outputRef: typeof normalizedRequest.data.outputRef === 'string' ? normalizedRequest.data.outputRef : null,
					summary: normalizedRequest.data.summary as Record<string, unknown> | null | undefined,
					actor: request.actor,
				}) as Promise<Record<string, unknown> | null>;
			}
			if (normalizedRequest.data.state === 'failed') {
				return this.failTask({
					id: taskId,
					errorCode: typeof normalizedRequest.data.errorCode === 'string' ? normalizedRequest.data.errorCode : null,
					errorMessage: String(normalizedRequest.data.errorMessage ?? 'Task failed'),
					retryable: Boolean(normalizedRequest.data.retryable),
					nextVisibleAt: typeof normalizedRequest.data.nextVisibleAt === 'string' ? normalizedRequest.data.nextVisibleAt : null,
					actor: request.actor,
				}) as Promise<Record<string, unknown> | null>;
			}
			return this.recordTaskProgress({
				id: taskId,
				workerId: typeof normalizedRequest.data.workerId === 'string' ? normalizedRequest.data.workerId : null,
				state: typeof normalizedRequest.data.state === 'string' ? normalizedRequest.data.state : undefined,
				appendEvent: normalizedRequest.data.appendEvent as { kind: string; data?: Record<string, unknown> } | null | undefined,
				patch: normalizedRequest.data.patch as Record<string, unknown> | undefined,
				actor: request.actor,
			}) as Promise<Record<string, unknown> | null>;
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

	startWorkDay(request: SdkStartWorkDayRequest) {
		return this.operational.startWorkDay(request);
	}

	closeWorkDay(request: SdkCloseWorkDayRequest) {
		return this.operational.closeWorkDay(request);
	}

	createTask(request: SdkCreateTaskRequest) {
		return this.operational.createTask(request);
	}

	claimTask(request: SdkClaimTaskRequest) {
		return this.operational.claimTask(request);
	}

	recordTaskProgress(request: SdkTaskProgressRequest) {
		return this.operational.recordTaskProgress(request);
	}

	completeTask(request: SdkCompleteTaskRequest) {
		return this.operational.completeTask(request);
	}

	failTask(request: SdkFailTaskRequest) {
		return this.operational.failTask(request);
	}

	appendTaskEvent(request: SdkAppendTaskEventRequest) {
		return this.operational.appendTaskEvent(request);
	}

	searchTasks(request: SdkTaskSearchRequest) {
		return this.operational.searchTasks(request);
	}

	createReport(request: SdkCreateReportRequest) {
		return this.operational.createReport(request);
	}

	async getManagerContext(taskId: string) {
		const task = await this.operational.getTask(taskId);
		const workDay = task ? await this.operational.getWorkDay(task.workDayId) : null;
		return {
			task,
			workDay,
			agent: null,
			graph: workDay?.graphVersion ? { graphVersion: workDay.graphVersion } : null,
		};
	}

	getWorkPolicy(projectId: string, environment: string = 'local') {
		return this.operational.getWorkPolicy(projectId, environment);
	}

	upsertWorkPolicy(request: SdkUpsertWorkPolicyRequest) {
		return this.operational.upsertWorkPolicy(request);
	}

	listPriorityOverrides(projectId: string) {
		return this.operational.listPriorityOverrides(projectId);
	}

	upsertPriorityOverride(request: SdkPriorityOverrideRequest) {
		return this.operational.upsertPriorityOverride(request);
	}

	createPrioritySnapshot(request: SdkCreatePrioritySnapshotRequest) {
		return this.operational.createPrioritySnapshot(request);
	}

	getLatestPrioritySnapshot(projectId: string, workDayId?: string | null) {
		return this.operational.getLatestPrioritySnapshot(projectId, workDayId);
	}

	recordTaskCredits(request: SdkRecordTaskCreditsRequest) {
		return this.operational.recordTaskCredits(request);
	}

	listTaskCredits(workDayId: string) {
		return this.operational.listTaskCredits(workDayId);
	}

	recordScaleDecision(request: SdkRecordScaleDecisionRequest) {
		return this.operational.recordScaleDecision(request);
	}

	getLatestScaleDecision(projectId: string, environment: string, poolName: string) {
		return this.operational.getLatestScaleDecision(projectId, environment, poolName);
	}

	listWorkstreams(projectId: string) {
		return this.knowledgeCoop.listWorkstreams(projectId);
	}

	getWorkstream(workstreamId: string) {
		return this.knowledgeCoop.getWorkstream(workstreamId);
	}

	upsertWorkstream(input: Partial<WorkstreamSummary> & Pick<WorkstreamSummary, 'projectId' | 'title'>) {
		return this.knowledgeCoop.upsertWorkstream(input);
	}

	appendWorkstreamEvent(input: Pick<WorkstreamEvent, 'projectId' | 'workstreamId' | 'kind'> & Partial<WorkstreamEvent>) {
		return this.knowledgeCoop.appendWorkstreamEvent(input);
	}

	listReleases(projectId: string) {
		return this.knowledgeCoop.listReleases(projectId);
	}

	getRelease(releaseId: string) {
		return this.knowledgeCoop.getRelease(releaseId);
	}

	upsertRelease(input: Partial<ReleaseSummary> & Pick<ReleaseSummary, 'projectId' | 'version'> & { items?: ReleaseDetail['items'] }): Promise<ReleaseDetail | null> {
		return this.knowledgeCoop.upsertRelease(input);
	}

	listSharePackages(projectId: string) {
		return this.knowledgeCoop.listSharePackages(projectId);
	}

	getSharePackage(packageId: string) {
		return this.knowledgeCoop.getSharePackage(packageId);
	}

	upsertSharePackage(input: Partial<SharePackageStatus> & Pick<SharePackageStatus, 'projectId' | 'kind' | 'title'>) {
		return this.knowledgeCoop.upsertSharePackage(input);
	}
}
