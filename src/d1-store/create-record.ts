import crypto from 'node:crypto';
import type { ContentLeaseRecord } from ".././types/agents.ts";
import type { D1DatabaseLike } from ".././types/cloudflare.ts";
import type { ReleaseDetail, ReleaseSummary, SharePackageStatus, InboxItem, WorkstreamDetail, WorkstreamEvent, WorkstreamSummary, } from ".././project-workflow.ts";
import { applyFilters, applySort } from ".././sdk-filters.ts";
import { normalizeFilterFields, normalizeMutationData, normalizeRecordToCanonicalShape, normalizeSortFields } from ".././sdk-fields.ts";
import { assertExpectedVersion } from ".././sdk-version.ts";
import { resolveModelDefinition } from ".././model-registry.ts";
import type { SdkAckMessageRequest, SdkClaimMessageRequest, ApprovalRequest, CreateApprovalRequestRequest, DecideApprovalRequestRequest, SdkCreateMessageRequest, SdkCursorEntity, SdkCursorRequest, SdkFilterCondition, SdkFollowRequest, SdkGetRequest, SdkGetCursorRequest, SdkLeaseEntity, SdkLeaseReleaseRequest, SdkMessageEntity, SdkMutationRequest, SdkPickRequest, SdkPickResult, SdkRecordRunRequest, SdkRunEntity, SdkSearchRequest, ListApprovalRequestsRequest, SdkSubscriptionEntity, UpsertTeamInboxItemRequest, SdkUpdateRequest, } from ".././sdk-types.ts";
import { CursorStore } from ".././stores/cursor-store.ts";
import { MemoryProjectWorkflowStore, SqliteProjectWorkflowStore } from ".././stores/project-workflow-store.ts";
import { LeaseStore, type LeaseClaimInput } from ".././stores/lease-store.ts";
import { MessageStore } from ".././stores/message-store.ts";
import { OperationalStore } from ".././stores/operational-store.ts";
import { RunStore } from ".././stores/run-store.ts";
import { SubscriptionStore } from ".././stores/subscription-store.ts";
import { TryClaimContentLeaseInput, D1Record, AgentDatabase, nowIso, nextLeaseToken, pickSortForRequest, filterSinceField, approvalStateFor, approvalRequestFromInput, decidedApprovalRequest, inboxItemFromInput, MemoryAgentDatabase, CloudflareD1AgentDatabase } from "../d1-store.ts";
export async function createMethod(this: MemoryAgentDatabase, request: SdkMutationRequest) {
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
        default:
            throw new Error(`Unsupported D1 create model "${request.model}".`);
    }
}
