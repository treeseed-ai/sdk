import type { AgentPermissionConfig, AgentRuntimeSpec } from "../../../types/agents.ts";
import { resolveSdkRepoRoot } from "../../../runtime/runtime.ts";
import { normalizeAgentCliOptions } from "../../../agents/cli-tools.ts";
import { ContentStore } from "../../../content/content-store.ts";
import { CloudflareD1AgentDatabase, MemoryAgentDatabase, type AgentDatabase } from "../../../persistence/d1-store.ts";
import { ContentGraphRuntime } from "../../../treedx/graph/graph.ts";
import { createTreeDxClientFromAgentOptions, LocalContentBackend, LocalGraphBackend, MissingTreeDxContentBackend, resolveTreeDxOptions, TreeDxContentBackend, TreeDxGraphBackend, TreeDxPortfolioResolver, type AgentSdkContentRepositoryOptions, type AgentSdkTreeDxOptions, type ContentBackend, type GraphBackend, } from "../../../treedx/repositories/treedx-backends.ts";
import { LocalGraphPort, LocalRepositoryPort, LocalRepositoryQueryPort, TreeDxArtifactPort, TreeDxExecPort, TreeDxFederatedClient, TreeDxFederatedPort, TreeDxGraphAdapter, TreeDxGraphPort, TreeDxRegistryClient, TreeDxRegistryPort, TreeDxRepositoryPort, TreeDxRepositoryQueryPort, TreeDxClient as PublicTreeDxClient, type TreeDxClientOptions as PublicTreeDxClientOptions, } from "../../../treedx/index.ts";
import { loadPlugins, type LoadedPluginRegistration } from "../../../platform/support/plugins.ts";
import { buildScopedModelRegistry, resolveModelDefinition } from "../../../entrypoints/models/model-registry.ts";
import { findDispatchCapability } from "../../../entrypoints/dispatch/dispatch.ts";
import { RemoteClient, RemoteDispatchClient } from "../../../entrypoints/clients/remote.ts";
import { executeSdkOperation } from "../../../entrypoints/models/sdk-dispatch.ts";
import { OperationsSdk } from "../../../operations/runtime/runtime.ts";
import type { ReleaseDetail, ReleaseSummary, SharePackageStatus, WorkstreamDetail, WorkstreamEvent, WorkstreamSummary, } from "../../../projects/projects-core/project-workflow.ts";
import type { SdkAckMessageRequest, SdkClaimMessageRequest, CreateApprovalRequestRequest, SdkCreateMessageRequest, SdkCursorRequest, SdkFollowRequest, SdkGetRequest, SdkGetCursorRequest, SdkJsonEnvelope, SdkLeaseReleaseRequest, SdkMutationRequest, SdkGraphQueryOptions, SdkGraphQueryRequest, SdkGraphRefreshRequest, SdkGraphSearchOptions, SdkContextPackRequest, SdkGraphDslParseResult, SdkPickRequest, SdkRecordRunRequest, SdkSearchRequest, SdkUpdateRequest, SdkModelDefinition, SdkModelRegistry, SdkGraphRankingProvider, SdkDispatchConfig, SdkDispatchRequest, SdkDispatchResult, SdkDispatchCredentialSource, DecideApprovalRequestRequest, ListApprovalRequestsRequest, UpsertTeamInboxItemRequest, } from "../../../entrypoints/models/sdk-types.ts";
import { NodeSqliteD1Database } from "../../../db/node-sqlite.ts";
import { AgentSdkOptions, normalizeAgentSpec, normalizeOperation, operationAllowed, AgentSdk, ScopedAgentSdk } from "../../../entrypoints/models/sdk.ts";
export function getNeighborsMethod(this: AgentSdk, id: string, options?: SdkGraphQueryOptions) {
    return this.localGraphRuntime.getNeighbors(id, options);
}
