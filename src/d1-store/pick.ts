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
export async function pickMethod(this: MemoryAgentDatabase, request: SdkPickRequest): Promise<SdkPickResult<Record<string, unknown>>> {
    if (request.model === 'message') {
        const candidates = [...this.messages.values()]
            .filter((message) => (message.status === 'pending' || message.status === 'failed')
            && new Date(message.availableAt).valueOf() <= Date.now()
            && (!request.filters
                ?.filter((filter) => filter.field === 'type' && filter.op === 'in')
                .flatMap((filter) => (Array.isArray(filter.value) ? filter.value.map(String) : []))
                .length
                || request.filters
                    .filter((filter) => filter.field === 'type' && filter.op === 'in')
                    .flatMap((filter) => (Array.isArray(filter.value) ? filter.value.map(String) : []))
                    .includes(message.type)))
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
