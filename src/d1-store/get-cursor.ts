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
export async function getCursorMethod(this: MemoryAgentDatabase, request: SdkGetCursorRequest) {
    return this.cursors.get(`${request.agentSlug}:${request.cursorKey}`) ?? null;
}
