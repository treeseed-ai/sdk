import crypto from 'node:crypto';
import type { ContentLeaseRecord } from "../../../types/agents.ts";
import type { D1DatabaseLike } from "../../../types/cloudflare.ts";
import type { ReleaseDetail, ReleaseSummary, SharePackageStatus, InboxItem, WorkstreamDetail, WorkstreamEvent, WorkstreamSummary, } from "../../../projects/projects-core/project-workflow.ts";
import { applyFilters, applySort } from "../../../entrypoints/models/sdk-filters.ts";
import { normalizeFilterFields, normalizeMutationData, normalizeRecordToCanonicalShape, normalizeSortFields } from "../../../entrypoints/models/sdk-fields.ts";
import { assertExpectedVersion } from "../../../packages/sdk-version.ts";
import { resolveModelDefinition } from "../../../entrypoints/models/model-registry.ts";
import type { SdkAckMessageRequest, SdkClaimMessageRequest, ApprovalRequest, CreateApprovalRequestRequest, DecideApprovalRequestRequest, SdkCreateMessageRequest, SdkCursorEntity, SdkCursorRequest, SdkFilterCondition, SdkFollowRequest, SdkGetRequest, SdkGetCursorRequest, SdkLeaseEntity, SdkLeaseReleaseRequest, SdkMessageEntity, SdkMutationRequest, SdkPickRequest, SdkPickResult, SdkRecordRunRequest, SdkRunEntity, SdkSearchRequest, ListApprovalRequestsRequest, SdkSubscriptionEntity, UpsertTeamInboxItemRequest, SdkUpdateRequest, } from "../../../entrypoints/models/sdk-types.ts";
import { CursorStore } from "../../../stores/cursor-store.ts";
import { MemoryProjectWorkflowStore, SqliteProjectWorkflowStore } from "../../../stores/project-workflow-store.ts";
import { LeaseStore, type LeaseClaimInput } from "../../../stores/lease-store.ts";
import { MessageStore } from "../../../stores/message-store.ts";
import { OperationalStore } from "../../../stores/operational-store.ts";
import { RunStore } from "../../../stores/run-store.ts";
import { SubscriptionStore } from "../../../stores/subscription-store.ts";
import { TryClaimContentLeaseInput, D1Record, AgentDatabase, nowIso, nextLeaseToken, pickSortForRequest, filterSinceField, approvalStateFor, approvalRequestFromInput, decidedApprovalRequest, inboxItemFromInput, MemoryAgentDatabase, CloudflareD1AgentDatabase } from "../../../persistence/d1-store.ts";
export async function claimMessageMethod(this: MemoryAgentDatabase, request: SdkClaimMessageRequest) {
    const pending = [...this.messages.values()]
        .filter((message) => (message.status === 'pending' || message.status === 'failed')
        && new Date(message.availableAt).valueOf() <= Date.now()
        && (!request.messageTypes?.length || request.messageTypes.includes(message.type)))
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
