import type { AgentPermissionConfig, AgentRuntimeSpec } from ".././types/agents.ts";
import { resolveSdkRepoRoot } from ".././runtime.ts";
import { normalizeAgentCliOptions } from ".././cli-tools.ts";
import { ContentStore } from ".././content-store.ts";
import { CloudflareD1AgentDatabase, MemoryAgentDatabase, type AgentDatabase } from ".././d1-store.ts";
import { ContentGraphRuntime } from ".././graph.ts";
import { createTreeDxClientFromAgentOptions, LocalContentBackend, LocalGraphBackend, MissingTreeDxContentBackend, resolveTreeDxOptions, TreeDxContentBackend, TreeDxGraphBackend, TreeDxPortfolioResolver, type AgentSdkContentRepositoryOptions, type AgentSdkTreeDxOptions, type ContentBackend, type GraphBackend, } from ".././treedx-backends.ts";
import { LocalGraphPort, LocalRepositoryPort, LocalRepositoryQueryPort, TreeDxArtifactPort, TreeDxExecPort, TreeDxFederatedClient, TreeDxFederatedPort, TreeDxGraphAdapter, TreeDxGraphPort, TreeDxRegistryClient, TreeDxRegistryPort, TreeDxRepositoryPort, TreeDxRepositoryQueryPort, TreeDxClient as PublicTreeDxClient, type TreeDxClientOptions as PublicTreeDxClientOptions, } from ".././treedx/index.ts";
import { loadTreeseedPlugins, type LoadedTreeseedPluginEntry } from ".././platform/plugins.ts";
import { buildScopedModelRegistry, resolveModelDefinition } from ".././model-registry.ts";
import { findDispatchCapability } from ".././dispatch.ts";
import { RemoteTreeseedClient, RemoteTreeseedDispatchClient } from ".././remote.ts";
import { executeSdkOperation } from ".././sdk-dispatch.ts";
import { TreeseedOperationsSdk } from ".././operations/runtime.ts";
import type { ReleaseDetail, ReleaseSummary, SharePackageStatus, WorkstreamDetail, WorkstreamEvent, WorkstreamSummary, } from ".././project-workflow.ts";
import type { SdkAckMessageRequest, SdkClaimMessageRequest, CreateApprovalRequestRequest, SdkCreateMessageRequest, SdkCursorRequest, SdkFollowRequest, SdkGetRequest, SdkGetCursorRequest, SdkJsonEnvelope, SdkLeaseReleaseRequest, SdkMutationRequest, SdkGraphQueryOptions, SdkGraphQueryRequest, SdkGraphRefreshRequest, SdkGraphSearchOptions, SdkContextPackRequest, SdkGraphDslParseResult, SdkPickRequest, SdkRecordRunRequest, SdkSearchRequest, SdkUpdateRequest, SdkModelDefinition, SdkModelRegistry, SdkGraphRankingProvider, SdkDispatchConfig, SdkDispatchRequest, SdkDispatchResult, SdkDispatchCredentialSource, DecideApprovalRequestRequest, ListApprovalRequestsRequest, UpsertTeamInboxItemRequest, } from ".././sdk-types.ts";
import { NodeSqliteD1Database } from ".././db/node-sqlite.ts";
import { AgentSdkOptions, normalizeAgentSpec, normalizeOperation, operationAllowed, AgentSdk, ScopedAgentSdk } from "../sdk.ts";
export function getSubgraphMethod(this: AgentSdk, seedIds: string[], options?: SdkGraphQueryOptions) {
    return this.localGraphRuntime.getSubgraph(seedIds, options);
}
