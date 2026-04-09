import type { ContentLeaseRecord } from './types/agents.ts';
import type { D1DatabaseLike } from './types/cloudflare.ts';
import type { SdkAckMessageRequest, SdkClaimMessageRequest, SdkCreateMessageRequest, SdkCursorEntity, SdkCursorRequest, SdkFollowRequest, SdkGetRequest, SdkGetCursorRequest, SdkLeaseEntity, SdkLeaseReleaseRequest, SdkMessageEntity, SdkMutationRequest, SdkPickRequest, SdkPickResult, SdkRecordRunRequest, SdkRunEntity, SdkSearchRequest, SdkSubscriptionEntity, SdkUpdateRequest } from './sdk-types.ts';
import { type LeaseClaimInput } from './stores/lease-store.ts';
export interface TryClaimContentLeaseInput extends LeaseClaimInput {
}
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
}
export declare class MemoryAgentDatabase implements AgentDatabase {
    private readonly subscriptions;
    private readonly messages;
    private readonly runs;
    private readonly contentLeases;
    private readonly cursors;
    private messageId;
    constructor(seed?: {
        subscriptions?: SdkSubscriptionEntity[];
        messages?: SdkMessageEntity[];
        runs?: SdkRunEntity[];
        cursors?: SdkCursorEntity[];
        leases?: SdkLeaseEntity[];
    });
    private rowsForModel;
    get(request: SdkGetRequest): Promise<Record<string, unknown>>;
    search(request: SdkSearchRequest): Promise<Record<string, unknown>[]>;
    follow(request: SdkFollowRequest): Promise<{
        items: Record<string, unknown>[];
        since: string;
    }>;
    pick(request: SdkPickRequest): Promise<SdkPickResult<Record<string, unknown>>>;
    create(request: SdkMutationRequest): Promise<Record<string, unknown>>;
    update(request: SdkUpdateRequest): Promise<Record<string, unknown> | {
        updated_at: string;
        id?: number;
        recordType?: import("./sdk-types.ts").TreeseedRuntimeRecordType;
        schemaVersion?: import("./sdk-types.ts").TreeseedSchemaVersion;
        email: string;
        name?: string | null;
        status: string;
        source?: string;
        metaJson?: string;
        consent_at?: string;
        created_at?: string;
        ip_hash?: string;
    }>;
    claimMessage(request: SdkClaimMessageRequest): Promise<SdkMessageEntity>;
    ackMessage(request: SdkAckMessageRequest): Promise<void>;
    createMessage(request: SdkCreateMessageRequest): Promise<SdkMessageEntity>;
    recordRun(request: SdkRecordRunRequest): Promise<SdkRunEntity>;
    getCursor(request: SdkGetCursorRequest): Promise<string>;
    upsertCursor(request: SdkCursorRequest): Promise<void>;
    releaseLease(request: SdkLeaseReleaseRequest): Promise<void>;
    tryClaimContentLease(input: TryClaimContentLeaseInput): Promise<`${string}-${string}-${string}-${string}-${string}`>;
    releaseAllLeases(): Promise<number>;
    inspectRuns(): SdkRunEntity[];
    inspectLeases(): ContentLeaseRecord[];
}
export declare class CloudflareD1AgentDatabase implements AgentDatabase {
    readonly db: D1DatabaseLike;
    private readonly subscriptions;
    private readonly messages;
    private readonly runs;
    private readonly cursors;
    private readonly leases;
    constructor(db: D1DatabaseLike);
    get(request: SdkGetRequest): Promise<Record<string, unknown>>;
    search(request: SdkSearchRequest): Promise<Record<string, unknown>[]>;
    follow(request: SdkFollowRequest): Promise<{
        items: Record<string, unknown>[];
        since: string;
    }>;
    pick(request: SdkPickRequest): Promise<{
        item: Record<string, unknown> | null;
        leaseToken: string;
    }>;
    create(request: SdkMutationRequest): Promise<Record<string, unknown>>;
    update(request: SdkUpdateRequest): Promise<Record<string, unknown>>;
    claimMessage(request: SdkClaimMessageRequest): Promise<SdkMessageEntity>;
    ackMessage(request: SdkAckMessageRequest): Promise<void>;
    createMessage(request: SdkCreateMessageRequest): Promise<SdkMessageEntity>;
    recordRun(request: SdkRecordRunRequest): Promise<SdkRunEntity>;
    getCursor(request: SdkGetCursorRequest): Promise<string>;
    upsertCursor(request: SdkCursorRequest): Promise<void>;
    releaseLease(request: SdkLeaseReleaseRequest): Promise<void>;
    tryClaimContentLease(input: TryClaimContentLeaseInput): Promise<`${string}-${string}-${string}-${string}-${string}`>;
    releaseAllLeases(): Promise<number>;
}
