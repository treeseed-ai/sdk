import crypto from 'node:crypto';
import type { ContentLeaseRecord } from './types/agents.ts';
import type { D1DatabaseLike } from './types/cloudflare.ts';
import type {
	ReleaseDetail,
	ReleaseSummary,
	SharePackageStatus,
	InboxItem,
	WorkstreamDetail,
	WorkstreamEvent,
	WorkstreamSummary,
} from './project-workflow.ts';
import { applyFilters, applySort } from './sdk-filters.ts';
import { normalizeFilterFields, normalizeMutationData, normalizeRecordToCanonicalShape, normalizeSortFields } from './sdk-fields.ts';
import { assertExpectedVersion } from './sdk-version.ts';
import { resolveModelDefinition } from './model-registry.ts';
import type {
	SdkAckMessageRequest,
	SdkClaimMessageRequest,
	SdkCloseWorkDayRequest,
	ApprovalRequest,
	SdkCreateReportRequest,
	CreateApprovalRequestRequest,
	DecideApprovalRequestRequest,
	SdkCreateMessageRequest,
	SdkCreatePrioritySnapshotRequest,
	SdkCursorEntity,
	SdkCursorRequest,
	SdkFilterCondition,
	SdkFollowRequest,
	SdkGraphRunEntity,
	SdkGetRequest,
	SdkGetCursorRequest,
	SdkLeaseEntity,
	SdkLeaseReleaseRequest,
	SdkMessageEntity,
	SdkMutationRequest,
	SdkPickRequest,
	SdkPickResult,
	SdkPriorityOverrideRequest,
	SdkClaimWorkdayManagerLeaseRequest,
	SdkCreateWorkdayRequest,
	SdkRecordRepositoryClaimRequest,
	SdkRecordRunnerScaleDecisionRequest,
	SdkRecordWorkerRunnerRequest,
	SdkRecordRunRequest,
	SdkRecordScaleDecisionRequest,
	SdkRecordTaskCreditsRequest,
	SdkReleaseWorkdayManagerLeaseRequest,
	SdkReportEntity,
	SdkRunEntity,
	SdkSearchRequest,
	SdkStartWorkDayRequest,
	ListApprovalRequestsRequest,
	SdkSubscriptionEntity,
	UpsertTeamInboxItemRequest,
	SdkUpsertWorkPolicyRequest,
	SdkUpdateWorkDayGraphRequest,
	SdkUpdateRequest,
	SdkWorkDayEntity,
	RepositoryClaim,
	RunnerScaleDecision,
	ScaleDecision,
	TaskCreditLedgerEntry,
	WorkdayManagerLease,
	WorkdayPolicy,
	WorkdayRequest,
	WorkerRunner,
	PrioritySnapshot,
} from './sdk-types.ts';
import { CursorStore } from './stores/cursor-store.ts';
import { MemoryProjectWorkflowStore, SqliteProjectWorkflowStore } from './stores/project-workflow-store.ts';
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
	createReport(request: SdkCreateReportRequest): Promise<SdkReportEntity | null>;
	getWorkPolicy(projectId: string, environment?: string): Promise<WorkdayPolicy | null>;
	upsertWorkPolicy(request: SdkUpsertWorkPolicyRequest): Promise<WorkdayPolicy | null>;
	createWorkdayRequest(request: SdkCreateWorkdayRequest): Promise<WorkdayRequest | null>;
	listWorkdayRequests(projectId: string, environment: string, state?: string | null): Promise<WorkdayRequest[]>;
	claimWorkdayManagerLease(request: SdkClaimWorkdayManagerLeaseRequest): Promise<WorkdayManagerLease | null>;
	releaseWorkdayManagerLease(request: SdkReleaseWorkdayManagerLeaseRequest): Promise<WorkdayManagerLease | null>;
	listWorkdayManagerLeases(projectId: string, environment: string): Promise<WorkdayManagerLease[]>;
	recordWorkerRunner(request: SdkRecordWorkerRunnerRequest): Promise<WorkerRunner | null>;
	listWorkerRunners(projectId: string, environment: string): Promise<WorkerRunner[]>;
	recordRepositoryClaim(request: SdkRecordRepositoryClaimRequest): Promise<RepositoryClaim | null>;
	listRepositoryClaims(projectId: string, repositoryId?: string | null): Promise<RepositoryClaim[]>;
	recordRunnerScaleDecision(request: SdkRecordRunnerScaleDecisionRequest): Promise<RunnerScaleDecision | null>;
	listRunnerScaleDecisions(projectId: string, environment: string, workDayId?: string | null): Promise<RunnerScaleDecision[]>;
	updateWorkDayGraph(request: SdkUpdateWorkDayGraphRequest): Promise<SdkWorkDayEntity | null>;
	listPriorityOverrides(projectId: string): Promise<Record<string, unknown>[]>;
	upsertPriorityOverride(request: SdkPriorityOverrideRequest): Promise<Record<string, unknown> | null>;
	createPrioritySnapshot(request: SdkCreatePrioritySnapshotRequest): Promise<PrioritySnapshot | null>;
	getLatestPrioritySnapshot(projectId: string, workDayId?: string | null): Promise<PrioritySnapshot | null>;
	recordTaskCredits(request: SdkRecordTaskCreditsRequest): Promise<TaskCreditLedgerEntry | null>;
	listTaskCredits(workDayId: string): Promise<TaskCreditLedgerEntry[]>;
	recordScaleDecision(request: SdkRecordScaleDecisionRequest): Promise<ScaleDecision | null>;
	getLatestScaleDecision(projectId: string, environment: string, poolName: string): Promise<ScaleDecision | null>;
	createApprovalRequest(request: CreateApprovalRequestRequest): Promise<ApprovalRequest | null>;
	listApprovalRequests(request: ListApprovalRequestsRequest): Promise<ApprovalRequest[]>;
	decideApprovalRequest(id: string, request: DecideApprovalRequestRequest): Promise<ApprovalRequest | null>;
	upsertTeamInboxItem(request: UpsertTeamInboxItemRequest): Promise<InboxItem | null>;
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

function approvalStateFor(value: string | null | undefined) {
	const state = String(value ?? 'pending').trim();
	return state || 'pending';
}

function approvalRequestFromInput(input: CreateApprovalRequestRequest, existing?: ApprovalRequest | null): ApprovalRequest {
	const timestamp = nowIso();
	return {
		id: input.id ?? existing?.id ?? crypto.randomUUID(),
		teamId: input.teamId,
		projectId: input.projectId,
		workDayId: input.workDayId ?? existing?.workDayId ?? null,
		taskId: input.taskId ?? existing?.taskId ?? null,
		kind: input.kind,
		state: existing?.state ?? 'pending',
		severity: input.severity ?? existing?.severity ?? 'medium',
		requestedByType: input.requestedByType ?? existing?.requestedByType ?? 'worker',
		requestedById: input.requestedById ?? existing?.requestedById ?? null,
		title: input.title,
		summary: input.summary,
		options: input.options ?? existing?.options ?? [],
		recommendation: input.recommendation ?? existing?.recommendation ?? {},
		policySnapshot: input.policySnapshot ?? existing?.policySnapshot ?? {},
		expiresAt: input.expiresAt ?? existing?.expiresAt ?? null,
		decidedByType: existing?.decidedByType ?? null,
		decidedById: existing?.decidedById ?? null,
		decidedAt: existing?.decidedAt ?? null,
		decision: existing?.decision ?? null,
		metadata: input.metadata ?? existing?.metadata ?? {},
		createdAt: existing?.createdAt ?? timestamp,
		updatedAt: timestamp,
	};
}

function decidedApprovalRequest(existing: ApprovalRequest, input: DecideApprovalRequestRequest): ApprovalRequest {
	const timestamp = nowIso();
	return {
		...existing,
		state: approvalStateFor(input.state) as ApprovalRequest['state'],
		decidedByType: input.decidedByType ?? 'user',
		decidedById: input.decidedById ?? null,
		decidedAt: timestamp,
		decision: {
			...(input.decision ?? {}),
			...(input.optionId ? { optionId: input.optionId } : {}),
			...(input.note ? { note: input.note } : {}),
		},
		updatedAt: timestamp,
	};
}

function inboxItemFromInput(input: UpsertTeamInboxItemRequest, existing?: InboxItem | null): InboxItem {
	const timestamp = nowIso();
	return {
		id: input.id ?? existing?.id ?? crypto.randomUUID(),
		teamId: input.teamId,
		projectId: input.projectId ?? existing?.projectId ?? null,
		kind: input.kind,
		state: input.state,
		title: input.title,
		summary: input.summary ?? existing?.summary ?? null,
		href: input.href ?? existing?.href ?? null,
		itemKey: input.itemKey ?? existing?.itemKey ?? null,
		metadata: input.metadata ?? existing?.metadata ?? {},
		createdAt: existing?.createdAt ?? timestamp,
		updatedAt: timestamp,
	};
}

export class MemoryAgentDatabase implements AgentDatabase {
	private readonly subscriptions = new Map<string, SdkSubscriptionEntity>();
	private readonly messages = new Map<number, SdkMessageEntity>();
	private readonly runs = new Map<string, SdkRunEntity>();
	private readonly contentLeases = new Map<string, ContentLeaseRecord>();
	private readonly cursors = new Map<string, string>();
	private readonly workDays = new Map<string, SdkWorkDayEntity>();
	private readonly graphRuns = new Map<string, SdkGraphRunEntity>();
	private readonly reports = new Map<string, SdkReportEntity>();
	private readonly workPolicies = new Map<string, WorkdayPolicy>();
	private readonly workdayRequests = new Map<string, WorkdayRequest>();
	private readonly workdayManagerLeases = new Map<string, WorkdayManagerLease>();
	private readonly workerRunners = new Map<string, WorkerRunner>();
	private readonly repositoryClaims = new Map<string, RepositoryClaim>();
	private readonly runnerScaleDecisions = new Map<string, RunnerScaleDecision>();
	private readonly priorityOverrides = new Map<string, Record<string, unknown>>();
	private readonly prioritySnapshots = new Map<string, PrioritySnapshot>();
	private readonly taskCreditLedger = new Map<string, TaskCreditLedgerEntry>();
	private readonly scaleDecisions = new Map<string, ScaleDecision>();
	private readonly approvalRequests = new Map<string, ApprovalRequest>();
	private readonly teamInboxItems = new Map<string, InboxItem>();
	private readonly projectWorkflow = new MemoryProjectWorkflowStore();
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

	async getWorkPolicy(projectId: string, environment: string = 'local') {
		return this.workPolicies.get(`${projectId}:${environment}`) ?? null;
	}

	async upsertWorkPolicy(request: SdkUpsertWorkPolicyRequest) {
		const dailyCreditBudget = Number(request.dailyCreditBudget ?? request.dailyTaskCreditBudget ?? 0);
		const policy: WorkdayPolicy = {
			projectId: request.projectId,
			environment: request.environment,
			schedule: request.schedule,
			enabled: request.enabled ?? true,
			startCron: request.startCron ?? '0 9 * * 1-5',
			durationMinutes: Number(request.durationMinutes ?? 480),
			maxRunners: Number(request.maxRunners ?? request.autoscale.maxWorkers ?? 1),
			maxWorkersPerRunner: Number(request.maxWorkersPerRunner ?? 4),
			dailyCreditBudget,
			closeoutGraceMinutes: Number(request.closeoutGraceMinutes ?? 15),
			dailyTaskCreditBudget: dailyCreditBudget,
			maxQueuedTasks: request.maxQueuedTasks,
			maxQueuedCredits: request.maxQueuedCredits,
			autoscale: request.autoscale,
			creditWeights: request.creditWeights ?? [],
			metadata: request.metadata ?? {},
		};
		this.workPolicies.set(`${request.projectId}:${request.environment}`, policy);
		return policy;
	}

	async createWorkdayRequest(request: SdkCreateWorkdayRequest) {
		const timestamp = nowIso();
		const record: WorkdayRequest = {
			id: request.id ?? crypto.randomUUID(),
			projectId: request.projectId,
			environment: request.environment,
			type: request.type,
			state: request.state ?? 'pending',
			workDayId: request.workDayId ?? null,
			requestedBy: request.requestedBy ?? null,
			reason: request.reason ?? null,
			payload: request.payload ?? {},
			metadata: request.metadata ?? {},
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.workdayRequests.set(record.id, record);
		return record;
	}

	async listWorkdayRequests(projectId: string, environment: string, state?: string | null) {
		return [...this.workdayRequests.values()]
			.filter((entry) => entry.projectId === projectId && entry.environment === environment)
			.filter((entry) => !state || entry.state === state)
			.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
	}

	async claimWorkdayManagerLease(request: SdkClaimWorkdayManagerLeaseRequest) {
		const timestamp = request.now ?? nowIso();
		const nowMs = Date.parse(timestamp);
		const staleAfterMs = (request.staleAfterSeconds ?? request.ttlSeconds) * 1000;
		const existing = [...this.workdayManagerLeases.values()]
			.find((entry) => entry.projectId === request.projectId && entry.environment === request.environment && entry.state === 'active');
		if (existing && existing.managerId !== request.managerId) {
			const heartbeatMs = Date.parse(existing.heartbeatAt);
			if (Number.isFinite(heartbeatMs) && Number.isFinite(nowMs) && nowMs - heartbeatMs <= staleAfterMs) {
				return null;
			}
		}
		const id = existing?.id ?? request.id ?? crypto.randomUUID();
		const record: WorkdayManagerLease = {
			id,
			projectId: request.projectId,
			environment: request.environment,
			workDayId: request.workDayId ?? existing?.workDayId ?? null,
			managerId: request.managerId,
			state: 'active',
			heartbeatAt: timestamp,
			expiresAt: new Date(Date.parse(timestamp) + (request.ttlSeconds * 1000)).toISOString(),
			metadata: request.metadata ?? existing?.metadata ?? {},
			createdAt: existing?.createdAt ?? timestamp,
			updatedAt: timestamp,
		};
		this.workdayManagerLeases.set(id, record);
		return record;
	}

	async releaseWorkdayManagerLease(request: SdkReleaseWorkdayManagerLeaseRequest) {
		const existing = this.workdayManagerLeases.get(request.id);
		if (!existing || existing.managerId !== request.managerId) return null;
		const next = { ...existing, state: 'released' as const, updatedAt: nowIso() };
		this.workdayManagerLeases.set(next.id, next);
		return next;
	}

	async listWorkdayManagerLeases(projectId: string, environment: string) {
		return [...this.workdayManagerLeases.values()]
			.filter((entry) => entry.projectId === projectId && entry.environment === environment)
			.sort((left, right) => right.heartbeatAt.localeCompare(left.heartbeatAt))
			.slice(0, 10);
	}

	async recordWorkerRunner(request: SdkRecordWorkerRunnerRequest) {
		const timestamp = nowIso();
		const id = request.id ?? `${request.projectId}:${request.environment}:${request.runnerId}`;
		const activeLocalWorkers = Number(request.activeLocalWorkers ?? 0);
		const maxLocalWorkers = Number(request.maxLocalWorkers ?? 4);
		const record: WorkerRunner = {
			id,
			projectId: request.projectId,
			environment: request.environment,
			runnerId: request.runnerId,
			runnerServiceName: request.runnerServiceName,
			volumeIdentity: request.volumeIdentity,
			state: request.state ?? 'active',
			maxLocalWorkers,
			activeLocalWorkers,
			availableCapacity: Math.max(0, maxLocalWorkers - activeLocalWorkers),
			lastHeartbeatAt: timestamp,
			claimedRepositoryIds: request.claimedRepositoryIds ?? [],
			metadata: request.metadata ?? {},
			createdAt: this.workerRunners.get(id)?.createdAt ?? timestamp,
			updatedAt: timestamp,
		};
		this.workerRunners.set(id, record);
		return record;
	}

	async listWorkerRunners(projectId: string, environment: string) {
		return [...this.workerRunners.values()]
			.filter((entry) => entry.projectId === projectId && entry.environment === environment)
			.sort((left, right) => left.runnerId.localeCompare(right.runnerId));
	}

	async recordRepositoryClaim(request: SdkRecordRepositoryClaimRequest) {
		const timestamp = nowIso();
		const id = request.id ?? `${request.projectId}:${request.repositoryId}:${request.runnerId}`;
		const record: RepositoryClaim = {
			id,
			projectId: request.projectId,
			repositoryId: request.repositoryId,
			runnerId: request.runnerId,
			runnerServiceName: request.runnerServiceName,
			volumeIdentity: request.volumeIdentity,
			lastSeenCommit: request.lastSeenCommit ?? null,
			lastTaskAt: request.lastTaskAt ?? timestamp,
			claimState: request.claimState ?? 'active',
			metadata: request.metadata ?? {},
			createdAt: this.repositoryClaims.get(id)?.createdAt ?? timestamp,
			updatedAt: timestamp,
		};
		this.repositoryClaims.set(id, record);
		return record;
	}

	async listRepositoryClaims(projectId: string, repositoryId?: string | null) {
		return [...this.repositoryClaims.values()]
			.filter((entry) => entry.projectId === projectId)
			.filter((entry) => !repositoryId || entry.repositoryId === repositoryId)
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	}

	async recordRunnerScaleDecision(request: SdkRecordRunnerScaleDecisionRequest) {
		const record: RunnerScaleDecision = {
			id: request.id ?? crypto.randomUUID(),
			projectId: request.projectId,
			environment: request.environment,
			workDayId: request.workDayId ?? null,
			runnerId: request.runnerId ?? null,
			runnerServiceName: request.runnerServiceName ?? null,
			action: request.action,
			reason: request.reason,
			metadata: request.metadata ?? {},
			createdAt: nowIso(),
		};
		this.runnerScaleDecisions.set(record.id, record);
		return record;
	}

	async listRunnerScaleDecisions(projectId: string, environment: string, workDayId?: string | null) {
		return [...this.runnerScaleDecisions.values()]
			.filter((entry) => entry.projectId === projectId && entry.environment === environment)
			.filter((entry) => !workDayId || entry.workDayId === workDayId)
			.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
	}

	async updateWorkDayGraph(request: SdkUpdateWorkDayGraphRequest) {
		const existing = this.workDays.get(request.id);
		if (!existing) return null;
		const summary = {
			...(existing.summaryJson ? JSON.parse(existing.summaryJson) as Record<string, unknown> : {}),
			...(request.summaryPatch ?? {}),
		};
		const next = {
			...existing,
			graphVersion: request.graphVersion,
			summaryJson: JSON.stringify(summary),
			updatedAt: nowIso(),
		};
		this.workDays.set(next.id, next);
		return next;
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

	async createApprovalRequest(request: CreateApprovalRequestRequest) {
		const existing = request.id ? this.approvalRequests.get(request.id) : null;
		if (existing && existing.state !== 'pending') return existing;
		const approval = approvalRequestFromInput(request, existing);
		this.approvalRequests.set(approval.id, approval);
		return approval;
	}

	async listApprovalRequests(request: ListApprovalRequestsRequest = {}) {
		const states = request.state
			? new Set((Array.isArray(request.state) ? request.state : [request.state]).map(String))
			: null;
		return [...this.approvalRequests.values()]
			.filter((approval) => !request.projectId || approval.projectId === request.projectId)
			.filter((approval) => !request.teamId || approval.teamId === request.teamId)
			.filter((approval) => !states || states.has(approval.state))
			.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
			.slice(0, request.limit ?? 100);
	}

	async decideApprovalRequest(id: string, request: DecideApprovalRequestRequest) {
		const existing = this.approvalRequests.get(id);
		if (!existing) return null;
		const decided = decidedApprovalRequest(existing, request);
		this.approvalRequests.set(id, decided);
		return decided;
	}

	async upsertTeamInboxItem(request: UpsertTeamInboxItemRequest) {
		const id = request.id ?? request.itemKey ?? crypto.randomUUID();
		const existing = this.teamInboxItems.get(id) ?? [...this.teamInboxItems.values()]
			.find((item) => request.itemKey && item.teamId === request.teamId && item.itemKey === request.itemKey) ?? null;
		const item = inboxItemFromInput({ ...request, id }, existing);
		this.teamInboxItems.set(item.id, item);
		return item;
	}

	listWorkstreams(projectId: string) {
		return Promise.resolve(this.projectWorkflow.listWorkstreams(projectId));
	}

	getWorkstream(workstreamId: string) {
		return Promise.resolve(this.projectWorkflow.getWorkstream(workstreamId));
	}

	upsertWorkstream(input: Partial<WorkstreamSummary> & Pick<WorkstreamSummary, 'projectId' | 'title'>) {
		return Promise.resolve(this.projectWorkflow.upsertWorkstream(input));
	}

	appendWorkstreamEvent(input: Pick<WorkstreamEvent, 'projectId' | 'workstreamId' | 'kind'> & Partial<WorkstreamEvent>) {
		return Promise.resolve(this.projectWorkflow.appendWorkstreamEvent(input));
	}

	listReleases(projectId: string) {
		return Promise.resolve(this.projectWorkflow.listReleases(projectId));
	}

	getRelease(releaseId: string) {
		return Promise.resolve(this.projectWorkflow.getRelease(releaseId));
	}

	upsertRelease(input: Partial<ReleaseSummary> & Pick<ReleaseSummary, 'projectId' | 'version'> & { items?: ReleaseDetail['items'] }): Promise<ReleaseDetail | null> {
		return Promise.resolve(this.projectWorkflow.upsertRelease(input));
	}

	listSharePackages(projectId: string) {
		return Promise.resolve(this.projectWorkflow.listSharePackages(projectId));
	}

	getSharePackage(packageId: string) {
		return Promise.resolve(this.projectWorkflow.getSharePackage(packageId));
	}

	upsertSharePackage(input: Partial<SharePackageStatus> & Pick<SharePackageStatus, 'projectId' | 'kind' | 'title'>) {
		return Promise.resolve(this.projectWorkflow.upsertSharePackage(input));
	}
}

export class CloudflareD1AgentDatabase implements AgentDatabase {
	private readonly subscriptions: SubscriptionStore;
	private readonly messages: MessageStore;
	private readonly runs: RunStore;
	private readonly cursors: CursorStore;
	private readonly leases: LeaseStore;
	private readonly operational: OperationalStore;
	private readonly projectWorkflow: SqliteProjectWorkflowStore;

	constructor(readonly db: D1DatabaseLike) {
		this.subscriptions = new SubscriptionStore(db);
		this.messages = new MessageStore(db);
		this.runs = new RunStore(db);
		this.cursors = new CursorStore(db);
		this.leases = new LeaseStore(db);
		this.operational = new OperationalStore(db);
		this.projectWorkflow = new SqliteProjectWorkflowStore(db);
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

	createReport(request: SdkCreateReportRequest) {
		return this.operational.createReport(request);
	}

	getWorkPolicy(projectId: string, environment: string = 'local') {
		return this.operational.getWorkPolicy(projectId, environment);
	}

	upsertWorkPolicy(request: SdkUpsertWorkPolicyRequest) {
		return this.operational.upsertWorkPolicy(request);
	}

	createWorkdayRequest(request: SdkCreateWorkdayRequest) {
		return this.operational.createWorkdayRequest(request);
	}

	listWorkdayRequests(projectId: string, environment: string, state?: string | null) {
		return this.operational.listWorkdayRequests(projectId, environment, state);
	}

	claimWorkdayManagerLease(request: SdkClaimWorkdayManagerLeaseRequest) {
		return this.operational.claimWorkdayManagerLease(request);
	}

	releaseWorkdayManagerLease(request: SdkReleaseWorkdayManagerLeaseRequest) {
		return this.operational.releaseWorkdayManagerLease(request);
	}

	listWorkdayManagerLeases(projectId: string, environment: string) {
		return this.operational.listWorkdayManagerLeases(projectId, environment);
	}

	recordWorkerRunner(request: SdkRecordWorkerRunnerRequest) {
		return this.operational.recordWorkerRunner(request);
	}

	listWorkerRunners(projectId: string, environment: string) {
		return this.operational.listWorkerRunners(projectId, environment);
	}

	recordRepositoryClaim(request: SdkRecordRepositoryClaimRequest) {
		return this.operational.recordRepositoryClaim(request);
	}

	listRepositoryClaims(projectId: string, repositoryId?: string | null) {
		return this.operational.listRepositoryClaims(projectId, repositoryId);
	}

	recordRunnerScaleDecision(request: SdkRecordRunnerScaleDecisionRequest) {
		return this.operational.recordRunnerScaleDecision(request);
	}

	listRunnerScaleDecisions(projectId: string, environment: string, workDayId?: string | null) {
		return this.operational.listRunnerScaleDecisions(projectId, environment, workDayId);
	}

	updateWorkDayGraph(request: SdkUpdateWorkDayGraphRequest) {
		return this.operational.updateWorkDayGraph(request);
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

	createApprovalRequest(request: CreateApprovalRequestRequest) {
		return this.operational.createApprovalRequest(request);
	}

	listApprovalRequests(request: ListApprovalRequestsRequest = {}) {
		return this.operational.listApprovalRequests(request);
	}

	decideApprovalRequest(id: string, request: DecideApprovalRequestRequest) {
		return this.operational.decideApprovalRequest(id, request);
	}

	upsertTeamInboxItem(request: UpsertTeamInboxItemRequest) {
		return this.operational.upsertTeamInboxItem(request);
	}

	listWorkstreams(projectId: string) {
		return this.projectWorkflow.listWorkstreams(projectId);
	}

	getWorkstream(workstreamId: string) {
		return this.projectWorkflow.getWorkstream(workstreamId);
	}

	upsertWorkstream(input: Partial<WorkstreamSummary> & Pick<WorkstreamSummary, 'projectId' | 'title'>) {
		return this.projectWorkflow.upsertWorkstream(input);
	}

	appendWorkstreamEvent(input: Pick<WorkstreamEvent, 'projectId' | 'workstreamId' | 'kind'> & Partial<WorkstreamEvent>) {
		return this.projectWorkflow.appendWorkstreamEvent(input);
	}

	listReleases(projectId: string) {
		return this.projectWorkflow.listReleases(projectId);
	}

	getRelease(releaseId: string) {
		return this.projectWorkflow.getRelease(releaseId);
	}

	upsertRelease(input: Partial<ReleaseSummary> & Pick<ReleaseSummary, 'projectId' | 'version'> & { items?: ReleaseDetail['items'] }): Promise<ReleaseDetail | null> {
		return this.projectWorkflow.upsertRelease(input);
	}

	listSharePackages(projectId: string) {
		return this.projectWorkflow.listSharePackages(projectId);
	}

	getSharePackage(packageId: string) {
		return this.projectWorkflow.getSharePackage(packageId);
	}

	upsertSharePackage(input: Partial<SharePackageStatus> & Pick<SharePackageStatus, 'projectId' | 'kind' | 'title'>) {
		return this.projectWorkflow.upsertSharePackage(input);
	}
}
