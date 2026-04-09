import type { SdkCursorEntity, SdkLeaseEntity, SdkMessageEntity, SdkRunEntity, SdkSubscriptionEntity, TreeseedAgentRunMeta, TreeseedAgentRunPayload, TreeseedContactSubmissionMeta, TreeseedContactSubmissionPayload, TreeseedCursorMeta, TreeseedCursorPayload, TreeseedLeaseMeta, TreeseedLeasePayload, TreeseedMessageMeta, TreeseedMessagePayload, TreeseedRecordEnvelope, TreeseedSubscriptionMeta, TreeseedSubscriptionPayload } from '../sdk-types.ts';
export declare const TRESEED_ENVELOPE_SCHEMA_VERSION = 1;
export interface RuntimeRecordRow {
    id?: number;
    record_type?: string;
    record_key?: string | null;
    lookup_key?: string | null;
    secondary_key?: string | null;
    status?: string;
    schema_version?: number;
    created_at?: string;
    updated_at?: string;
    payload_json?: string;
    meta_json?: string;
}
export interface MessageQueueRow {
    id?: number;
    message_type?: string;
    status?: string;
    schema_version?: number;
    related_model?: string | null;
    related_id?: string | null;
    priority?: number;
    available_at?: string;
    claimed_by?: string | null;
    claimed_at?: string | null;
    lease_expires_at?: string | null;
    attempts?: number;
    max_attempts?: number;
    created_at?: string;
    updated_at?: string;
    payload_json?: string;
    meta_json?: string;
}
export interface CursorStateRow {
    agent_slug?: string;
    cursor_key?: string;
    status?: string;
    schema_version?: number;
    updated_at?: string;
    payload_json?: string;
    meta_json?: string;
}
export interface LeaseStateRow {
    model?: string;
    item_key?: string;
    status?: string;
    schema_version?: number;
    claimed_by?: string | null;
    claimed_at?: string | null;
    lease_expires_at?: string | null;
    created_at?: string;
    updated_at?: string;
    payload_json?: string;
    meta_json?: string;
}
export declare function createSubscriptionEnvelope(input: {
    email: string;
    name?: string | null;
    status?: string;
    source?: string;
    consentAt?: string | null;
    ipHash?: string;
    meta?: TreeseedSubscriptionMeta;
}): TreeseedRecordEnvelope<TreeseedSubscriptionPayload, TreeseedSubscriptionMeta>;
export declare function subscriptionEntityFromEnvelope(row: RuntimeRecordRow): SdkSubscriptionEntity;
export declare function createContactSubmissionEnvelope(input: {
    name: string;
    email: string;
    organization?: string | null;
    contactType: string;
    subject: string;
    message: string;
    userAgent: string;
    ipHash: string;
    meta?: TreeseedContactSubmissionMeta;
}): TreeseedRecordEnvelope<TreeseedContactSubmissionPayload, TreeseedContactSubmissionMeta>;
export declare function createMessageEnvelope(input: {
    type: string;
    payload: Record<string, unknown>;
    meta?: TreeseedMessageMeta;
}): TreeseedRecordEnvelope<TreeseedMessagePayload, TreeseedMessageMeta>;
export declare function messageEntityFromEnvelope(row: MessageQueueRow): SdkMessageEntity;
export declare function createRunEnvelope(input: {
    runId: string;
    agentSlug: string;
    status: string;
    triggerSource: string;
    startedAt: string;
    handlerKind?: string | null;
    triggerKind?: string | null;
    selectedItemKey?: string | null;
    selectedMessageId?: number | null;
    claimedMessageId?: number | null;
    branchName?: string | null;
    prUrl?: string | null;
    summary?: string | null;
    error?: string | null;
    errorCategory?: string | null;
    commitSha?: string | null;
    changedPaths?: string[];
    finishedAt?: string | null;
}): TreeseedRecordEnvelope<TreeseedAgentRunPayload, TreeseedAgentRunMeta>;
export declare function runEntityFromEnvelope(row: RuntimeRecordRow): SdkRunEntity;
export declare function createCursorEnvelope(input: {
    agentSlug: string;
    cursorKey: string;
    cursorValue: string;
    meta?: TreeseedCursorMeta;
}): TreeseedRecordEnvelope<TreeseedCursorPayload, TreeseedCursorMeta>;
export declare function cursorEntityFromEnvelope(row: CursorStateRow): SdkCursorEntity;
export declare function createLeaseEnvelope(input: {
    token: string;
    meta?: TreeseedLeaseMeta;
}): TreeseedRecordEnvelope<TreeseedLeasePayload, TreeseedLeaseMeta>;
export declare function leaseEntityFromEnvelope(row: LeaseStateRow): SdkLeaseEntity;
