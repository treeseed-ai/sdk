import type { AgentPermissionConfig, AgentRuntimeSpec } from './types/agents.ts';
import { ContentStore } from './content-store.ts';
import { type AgentDatabase } from './d1-store.ts';
import type { SdkAckMessageRequest, SdkClaimMessageRequest, SdkCreateMessageRequest, SdkCursorRequest, SdkFollowRequest, SdkGetRequest, SdkGetCursorRequest, SdkJsonEnvelope, SdkLeaseReleaseRequest, SdkMutationRequest, SdkPickRequest, SdkRecordRunRequest, SdkSearchRequest, SdkUpdateRequest } from './sdk-types.ts';
export interface AgentSdkOptions {
    repoRoot?: string;
    database?: AgentDatabase;
}
export declare class AgentSdk {
    readonly database: AgentDatabase;
    readonly content: ContentStore;
    constructor(options?: AgentSdkOptions);
    static createLocal(options: {
        repoRoot?: string;
        databaseName?: string;
        persistTo?: string;
    }): AgentSdk;
    private envelope;
    get(request: SdkGetRequest): Promise<SdkJsonEnvelope<Record<string, unknown> | import("./sdk-types.ts").SdkContentEntry>>;
    read(request: SdkGetRequest): Promise<{
        operation: "read";
        ok: boolean;
        model: import("./sdk-types.ts").SdkModelName;
        payload: Record<string, unknown> | import("./sdk-types.ts").SdkContentEntry;
        meta?: Record<string, unknown>;
    }>;
    search(request: SdkSearchRequest): Promise<SdkJsonEnvelope<Record<string, unknown>[] | import("./sdk-types.ts").SdkContentEntry[]>>;
    follow(request: SdkFollowRequest): Promise<SdkJsonEnvelope<{
        items: Record<string, unknown>[];
        since: string;
    } | {
        items: import("./sdk-types.ts").SdkContentEntry[];
        since: string;
    }>>;
    pick(request: SdkPickRequest): Promise<SdkJsonEnvelope<import("./sdk-types.ts").SdkPickResult<Record<string, unknown>> | import("./sdk-types.ts").SdkPickResult<import("./sdk-types.ts").SdkContentEntry>>>;
    create(request: SdkMutationRequest): Promise<SdkJsonEnvelope<Record<string, unknown> | {
        item: import("./sdk-types.ts").SdkContentEntry;
        git: import("./git-runtime.ts").GitMutationResult;
    }>>;
    update(request: SdkUpdateRequest): Promise<SdkJsonEnvelope<Record<string, unknown> | {
        item: import("./sdk-types.ts").SdkContentEntry;
        git: import("./git-runtime.ts").GitMutationResult;
    }>>;
    claimMessage(request: SdkClaimMessageRequest): Promise<SdkJsonEnvelope<import("./sdk-types.ts").SdkMessageEntity>>;
    ackMessage(request: SdkAckMessageRequest): Promise<SdkJsonEnvelope<{
        id: number;
        status: "pending" | "claimed" | "completed" | "failed" | "dead_letter";
    }>>;
    createMessage(request: SdkCreateMessageRequest): Promise<SdkJsonEnvelope<import("./sdk-types.ts").SdkMessageEntity>>;
    recordRun(request: SdkRecordRunRequest): Promise<SdkJsonEnvelope<Record<string, unknown>>>;
    getCursor(request: SdkGetCursorRequest): Promise<SdkJsonEnvelope<string>>;
    upsertCursor(request: SdkCursorRequest): Promise<SdkJsonEnvelope<SdkCursorRequest>>;
    releaseLease(request: SdkLeaseReleaseRequest): Promise<SdkJsonEnvelope<SdkLeaseReleaseRequest>>;
    releaseAllLeases(): Promise<SdkJsonEnvelope<{
        count: number;
    }>>;
    listAgentSpecs(options?: {
        enabled?: boolean;
    }): Promise<AgentRuntimeSpec[]>;
    listRawAgentSpecs(options?: {
        enabled?: boolean;
    }): Promise<Record<string, unknown>[] | import("./sdk-types.ts").SdkContentEntry[]>;
    scopeForAgent(agent: Pick<AgentRuntimeSpec, 'slug' | 'permissions'>): ScopedAgentSdk;
}
export declare class ScopedAgentSdk {
    private readonly base;
    private readonly actor;
    private readonly permissions;
    constructor(base: AgentSdk, actor: string, permissions: AgentPermissionConfig[]);
    private assertAllowed;
    get(request: SdkGetRequest): Promise<SdkJsonEnvelope<Record<string, unknown> | import("./sdk-types.ts").SdkContentEntry>>;
    read(request: SdkGetRequest): Promise<{
        operation: "read";
        ok: boolean;
        model: import("./sdk-types.ts").SdkModelName;
        payload: Record<string, unknown> | import("./sdk-types.ts").SdkContentEntry;
        meta?: Record<string, unknown>;
    }>;
    search(request: SdkSearchRequest): Promise<SdkJsonEnvelope<Record<string, unknown>[] | import("./sdk-types.ts").SdkContentEntry[]>>;
    follow(request: SdkFollowRequest): Promise<SdkJsonEnvelope<{
        items: Record<string, unknown>[];
        since: string;
    } | {
        items: import("./sdk-types.ts").SdkContentEntry[];
        since: string;
    }>>;
    pick(request: SdkPickRequest): Promise<SdkJsonEnvelope<import("./sdk-types.ts").SdkPickResult<Record<string, unknown>> | import("./sdk-types.ts").SdkPickResult<import("./sdk-types.ts").SdkContentEntry>>>;
    create(request: Omit<SdkMutationRequest, 'actor'>): Promise<SdkJsonEnvelope<Record<string, unknown> | {
        item: import("./sdk-types.ts").SdkContentEntry;
        git: import("./git-runtime.ts").GitMutationResult;
    }>>;
    update(request: Omit<SdkUpdateRequest, 'actor'>): Promise<SdkJsonEnvelope<Record<string, unknown> | {
        item: import("./sdk-types.ts").SdkContentEntry;
        git: import("./git-runtime.ts").GitMutationResult;
    }>>;
    claimMessage(request: SdkClaimMessageRequest): Promise<SdkJsonEnvelope<import("./sdk-types.ts").SdkMessageEntity>>;
    ackMessage(request: SdkAckMessageRequest): Promise<SdkJsonEnvelope<{
        id: number;
        status: "pending" | "claimed" | "completed" | "failed" | "dead_letter";
    }>>;
    createMessage(request: Omit<SdkCreateMessageRequest, 'actor'>): Promise<SdkJsonEnvelope<import("./sdk-types.ts").SdkMessageEntity>>;
    recordRun(request: SdkRecordRunRequest): Promise<SdkJsonEnvelope<Record<string, unknown>>>;
    getCursor(request: SdkGetCursorRequest): Promise<SdkJsonEnvelope<string>>;
    upsertCursor(request: SdkCursorRequest): Promise<SdkJsonEnvelope<SdkCursorRequest>>;
    releaseLease(request: SdkLeaseReleaseRequest): Promise<SdkJsonEnvelope<SdkLeaseReleaseRequest>>;
    releaseAllLeases(): Promise<SdkJsonEnvelope<{
        count: number;
    }>>;
}
