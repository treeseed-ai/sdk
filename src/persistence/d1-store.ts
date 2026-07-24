import crypto from 'node:crypto';
import type { ContentLeaseRecord } from '../types/agents.ts';
import type { D1DatabaseLike } from '../types/cloudflare.ts';
import type { ReleaseDetail, ReleaseSummary, SharePackageStatus, InboxItem, WorkstreamDetail, WorkstreamEvent, WorkstreamSummary, } from '../projects/projects-core/project-workflow.ts';
import { applyFilters, applySort } from '../entrypoints/models/sdk-filters.ts';
import { normalizeFilterFields, normalizeMutationData, normalizeRecordToCanonicalShape, normalizeSortFields } from '../entrypoints/models/sdk-fields.ts';
import { assertExpectedVersion } from '../packages/sdk-version.ts';
import { resolveModelDefinition } from '../entrypoints/models/model-registry.ts';
import type { SdkAckMessageRequest, SdkClaimMessageRequest, ApprovalRequest, CreateApprovalRequestRequest, DecideApprovalRequestRequest, SdkCreateMessageRequest, SdkCursorEntity, SdkCursorRequest, SdkFilterCondition, SdkFollowRequest, SdkGetRequest, SdkGetCursorRequest, SdkLeaseEntity, SdkLeaseReleaseRequest, SdkMessageEntity, SdkMutationRequest, SdkPickRequest, SdkPickResult, SdkRecordRunRequest, SdkRunEntity, SdkSearchRequest, ListApprovalRequestsRequest, SdkSubscriptionEntity, UpsertTeamInboxItemRequest, SdkUpdateRequest, } from '../entrypoints/models/sdk-types.ts';
import { CursorStore } from '../stores/cursor-store.ts';
import { MemoryProjectWorkflowStore, SqliteProjectWorkflowStore } from '../stores/project-workflow-store.ts';
import { LeaseStore, type LeaseClaimInput } from '../stores/lease-store.ts';
import { MessageStore } from '../stores/message-store.ts';
import { OperationalStore } from '../stores/operational-store.ts';
import { RunStore } from '../stores/run-store.ts';
import { SubscriptionStore } from '../stores/subscription-store.ts';
export interface TryClaimContentLeaseInput extends LeaseClaimInput {
}
export type D1Record = SdkSubscriptionEntity | SdkMessageEntity | SdkRunEntity | SdkCursorEntity | SdkLeaseEntity;
export interface AgentDatabase {
    get(request: SdkGetRequest): Promise<Record<string, unknown> | null>;
    search(request: SdkSearchRequest): Promise<Record<string, unknown>[]>;
    follow(request: SdkFollowRequest): Promise<{
        items: Record<string, unknown>[];
        since: string;
    }>;
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
    upsertRelease(input: Partial<ReleaseSummary> & Pick<ReleaseSummary, 'projectId' | 'version'> & {
        items?: ReleaseDetail['items'];
    }): Promise<ReleaseDetail | null>;
    listSharePackages(projectId: string): Promise<SharePackageStatus[]>;
    getSharePackage(packageId: string): Promise<SharePackageStatus | null>;
    upsertSharePackage(input: Partial<SharePackageStatus> & Pick<SharePackageStatus, 'projectId' | 'kind' | 'title'>): Promise<SharePackageStatus | null>;
}
export function nowIso() {
    return new Date().toISOString();
}
export function nextLeaseToken() {
    return crypto.randomUUID();
}
export function pickSortForRequest(request: SdkPickRequest, defaultField: string) {
    switch (request.strategy) {
        case 'oldest':
            return [{ field: defaultField, direction: 'asc' as const }];
        case 'highest_priority':
        case 'latest':
        default:
            return [{ field: defaultField, direction: 'desc' as const }];
    }
}
export function filterSinceField(model: string) {
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
export function approvalStateFor(value: string | null | undefined) {
    const state = String(value ?? 'pending').trim();
    return state || 'pending';
}
export function approvalRequestFromInput(input: CreateApprovalRequestRequest, existing?: ApprovalRequest | null): ApprovalRequest {
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
export function decidedApprovalRequest(existing: ApprovalRequest, input: DecideApprovalRequestRequest): ApprovalRequest {
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
export function inboxItemFromInput(input: UpsertTeamInboxItemRequest, existing?: InboxItem | null): InboxItem {
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
import * as extractedMethods from "../d1-store/methods.ts";
export class MemoryAgentDatabase implements AgentDatabase {
    readonly subscriptions = new Map<string, SdkSubscriptionEntity>();
    readonly messages = new Map<number, SdkMessageEntity>();
    readonly runs = new Map<string, SdkRunEntity>();
    readonly contentLeases = new Map<string, ContentLeaseRecord>();
    readonly cursors = new Map<string, string>();
    readonly approvalRequests = new Map<string, ApprovalRequest>();
    readonly teamInboxItems = new Map<string, InboxItem>();
    readonly projectWorkflow = new MemoryProjectWorkflowStore();
    messageId = 0;
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
}
export interface MemoryAgentDatabase {
    rowsForModel(model: string): D1Record[];
    get(request: SdkGetRequest);
    search(request: SdkSearchRequest);
    follow(request: SdkFollowRequest);
    pick(request: SdkPickRequest): Promise<SdkPickResult<Record<string, unknown>>>;
    create(request: SdkMutationRequest);
    update(request: SdkUpdateRequest);
    claimMessage(request: SdkClaimMessageRequest);
    ackMessage(request: SdkAckMessageRequest);
    createMessage(request: SdkCreateMessageRequest);
    recordRun(request: SdkRecordRunRequest);
    getCursor(request: SdkGetCursorRequest);
    upsertCursor(request: SdkCursorRequest);
    releaseLease(request: SdkLeaseReleaseRequest);
    tryClaimContentLease(input: TryClaimContentLeaseInput);
    releaseAllLeases();
    inspectRuns();
    inspectLeases();
    createApprovalRequest(request: CreateApprovalRequestRequest);
    listApprovalRequests(request?: ListApprovalRequestsRequest);
    decideApprovalRequest(id: string, request: DecideApprovalRequestRequest);
    upsertTeamInboxItem(request: UpsertTeamInboxItemRequest);
    listWorkstreams(projectId: string);
    getWorkstream(workstreamId: string);
    upsertWorkstream(input: Partial<WorkstreamSummary> & Pick<WorkstreamSummary, 'projectId' | 'title'>);
    appendWorkstreamEvent(input: Pick<WorkstreamEvent, 'projectId' | 'workstreamId' | 'kind'> & Partial<WorkstreamEvent>);
    listReleases(projectId: string);
    getRelease(releaseId: string);
    upsertRelease(input: Partial<ReleaseSummary> & Pick<ReleaseSummary, 'projectId' | 'version'> & {
        items?: ReleaseDetail['items'];
    }): Promise<ReleaseDetail | null>;
    listSharePackages(projectId: string);
    getSharePackage(packageId: string);
    upsertSharePackage(input: Partial<SharePackageStatus> & Pick<SharePackageStatus, 'projectId' | 'kind' | 'title'>);
}
MemoryAgentDatabase.prototype.rowsForModel = extractedMethods.rowsForModelMethod;
MemoryAgentDatabase.prototype.get = extractedMethods.getMethod;
MemoryAgentDatabase.prototype.search = extractedMethods.searchMethod;
MemoryAgentDatabase.prototype.follow = extractedMethods.followMethod;
MemoryAgentDatabase.prototype.pick = extractedMethods.pickMethod;
MemoryAgentDatabase.prototype.create = extractedMethods.createMethod;
MemoryAgentDatabase.prototype.update = extractedMethods.updateMethod;
MemoryAgentDatabase.prototype.claimMessage = extractedMethods.claimMessageMethod;
MemoryAgentDatabase.prototype.ackMessage = extractedMethods.ackMessageMethod;
MemoryAgentDatabase.prototype.createMessage = extractedMethods.createMessageMethod;
MemoryAgentDatabase.prototype.recordRun = extractedMethods.recordRunMethod;
MemoryAgentDatabase.prototype.getCursor = extractedMethods.getCursorMethod;
MemoryAgentDatabase.prototype.upsertCursor = extractedMethods.upsertCursorMethod;
MemoryAgentDatabase.prototype.releaseLease = extractedMethods.releaseLeaseMethod;
MemoryAgentDatabase.prototype.tryClaimContentLease = extractedMethods.tryClaimContentLeaseMethod;
MemoryAgentDatabase.prototype.releaseAllLeases = extractedMethods.releaseAllLeasesMethod;
MemoryAgentDatabase.prototype.inspectRuns = extractedMethods.inspectRunsMethod;
MemoryAgentDatabase.prototype.inspectLeases = extractedMethods.inspectLeasesMethod;
MemoryAgentDatabase.prototype.createApprovalRequest = extractedMethods.createApprovalRequestMethod;
MemoryAgentDatabase.prototype.listApprovalRequests = extractedMethods.listApprovalRequestsMethod;
MemoryAgentDatabase.prototype.decideApprovalRequest = extractedMethods.decideApprovalRequestMethod;
MemoryAgentDatabase.prototype.upsertTeamInboxItem = extractedMethods.upsertTeamInboxItemMethod;
MemoryAgentDatabase.prototype.listWorkstreams = extractedMethods.listWorkstreamsMethod;
MemoryAgentDatabase.prototype.getWorkstream = extractedMethods.getWorkstreamMethod;
MemoryAgentDatabase.prototype.upsertWorkstream = extractedMethods.upsertWorkstreamMethod;
MemoryAgentDatabase.prototype.appendWorkstreamEvent = extractedMethods.appendWorkstreamEventMethod;
MemoryAgentDatabase.prototype.listReleases = extractedMethods.listReleasesMethod;
MemoryAgentDatabase.prototype.getRelease = extractedMethods.getReleaseMethod;
MemoryAgentDatabase.prototype.upsertRelease = extractedMethods.upsertReleaseMethod;
MemoryAgentDatabase.prototype.listSharePackages = extractedMethods.listSharePackagesMethod;
MemoryAgentDatabase.prototype.getSharePackage = extractedMethods.getSharePackageMethod;
MemoryAgentDatabase.prototype.upsertSharePackage = extractedMethods.upsertSharePackageMethod;
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
        throw new Error(`Unsupported D1 search model "${request.model}".`);
    }
    async follow(request: SdkFollowRequest) {
        const field = request.model === 'subscription' || request.model === 'message'
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
            item: (await this.search({
                model: request.model,
                filters: request.filters,
                sort: pickSortForRequest(request, filterSinceField(request.model)),
                limit: 1,
            }))[0] ?? null,
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
    upsertRelease(input: Partial<ReleaseSummary> & Pick<ReleaseSummary, 'projectId' | 'version'> & {
        items?: ReleaseDetail['items'];
    }): Promise<ReleaseDetail | null> {
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
