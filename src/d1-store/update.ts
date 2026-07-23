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
export async function updateMethod(this: MemoryAgentDatabase, request: SdkUpdateRequest) {
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
            assertExpectedVersion(request.expectedVersion, (await this.get({ model: 'agent_run', key: String(request.id ?? request.key ?? data.run_id ?? '') })) as Record<string, unknown> | null, `agent_run "${String(request.id ?? request.key ?? data.run_id ?? '')}"`);
            return this.recordRun({ run: { ...data, runId: request.id ?? request.key ?? data.run_id } });
        case 'agent_cursor':
            assertExpectedVersion(request.expectedVersion, (await this.get({
                model: 'agent_cursor',
                key: `${String(data.agent_slug ?? request.id ?? request.key ?? '')}:${String(data.cursor_key ?? request.slug ?? '')}`,
            })) as Record<string, unknown> | null, `agent_cursor "${String(data.agent_slug ?? request.id ?? request.key ?? '')}:${String(data.cursor_key ?? request.slug ?? '')}"`);
            return this.create({
                model: 'agent_cursor',
                data,
                actor: request.actor,
            });
        case 'content_lease':
            assertExpectedVersion(request.expectedVersion, (await this.get({
                model: 'content_lease',
                key: `${String(data.model ?? request.id ?? '')}:${String(data.item_key ?? request.slug ?? request.key ?? '')}`,
            })) as Record<string, unknown> | null, `content_lease "${String(data.model ?? request.id ?? '')}:${String(data.item_key ?? request.slug ?? request.key ?? '')}"`);
            return this.create({
                model: 'content_lease',
                data,
                actor: request.actor,
            });
        default:
            throw new Error(`Unsupported D1 update model "${request.model}".`);
    }
}
