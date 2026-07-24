import type { AgentPermissionConfig, AgentRuntimeSpec } from "../../types/agents.ts";
import { resolveSdkRepoRoot } from "../../runtime/runtime.ts";
import { normalizeAgentCliOptions } from "../../agents/cli-tools.ts";
import { ContentStore } from "../../content/content-store.ts";
import { CloudflareD1AgentDatabase, MemoryAgentDatabase, type AgentDatabase } from "../../persistence/d1-store.ts";
import { ContentGraphRuntime } from "../../treedx/graph/graph.ts";
import { createTreeDxClientFromAgentOptions, LocalContentBackend, LocalGraphBackend, MissingTreeDxContentBackend, resolveTreeDxOptions, TreeDxContentBackend, TreeDxGraphBackend, TreeDxPortfolioResolver, type AgentSdkContentRepositoryOptions, type AgentSdkTreeDxOptions, type ContentBackend, type GraphBackend, } from "../../treedx/repositories/treedx-backends.ts";
import { LocalGraphPort, LocalRepositoryPort, LocalRepositoryQueryPort, TreeDxArtifactPort, TreeDxExecPort, TreeDxFederatedClient, TreeDxFederatedPort, TreeDxGraphAdapter, TreeDxGraphPort, TreeDxRegistryClient, TreeDxRegistryPort, TreeDxRepositoryPort, TreeDxRepositoryQueryPort, TreeDxClient as PublicTreeDxClient, type TreeDxClientOptions as PublicTreeDxClientOptions, } from "../../treedx/index.ts";
import { loadPlugins, type LoadedPluginRegistration } from "../../platform/support/plugins.ts";
import { buildScopedModelRegistry, resolveModelDefinition } from "../../entrypoints/models/model-registry.ts";
import { findDispatchCapability } from "../../entrypoints/dispatch/dispatch.ts";
import { RemoteClient, RemoteDispatchClient } from "../../entrypoints/clients/remote.ts";
import { executeSdkOperation } from "../../entrypoints/models/sdk-dispatch.ts";
import { OperationsSdk } from "../../operations/runtime/runtime.ts";
import type { ReleaseDetail, ReleaseSummary, SharePackageStatus, WorkstreamDetail, WorkstreamEvent, WorkstreamSummary, } from "../../projects/projects-core/project-workflow.ts";
import type { SdkAckMessageRequest, SdkClaimMessageRequest, CreateApprovalRequestRequest, SdkCreateMessageRequest, SdkCursorRequest, SdkFollowRequest, SdkGetRequest, SdkGetCursorRequest, SdkJsonEnvelope, SdkLeaseReleaseRequest, SdkMutationRequest, SdkGraphQueryOptions, SdkGraphQueryRequest, SdkGraphRefreshRequest, SdkGraphSearchOptions, SdkContextPackRequest, SdkGraphDslParseResult, SdkPickRequest, SdkRecordRunRequest, SdkSearchRequest, SdkUpdateRequest, SdkModelDefinition, SdkModelRegistry, SdkGraphRankingProvider, SdkDispatchConfig, SdkDispatchRequest, SdkDispatchResult, SdkDispatchCredentialSource, DecideApprovalRequestRequest, ListApprovalRequestsRequest, UpsertTeamInboxItemRequest, } from "../../entrypoints/models/sdk-types.ts";
import { NodeSqliteD1Database } from "../../db/node-sqlite.ts";
import { AgentSdkOptions, normalizeAgentSpec, normalizeOperation, operationAllowed, AgentSdk, ScopedAgentSdk } from "../../entrypoints/models/sdk.ts";
export async function executeDispatchLocallyMethod(this: AgentSdk, request: SdkDispatchRequest) {
    const namespace = request.namespace ?? 'sdk';
    if (namespace === 'workflow') {
        const operations = new OperationsSdk();
        return operations.execute({
            operationName: request.operation,
            input: request.input ?? {},
        }, {
            cwd: this.repoRoot,
            env: process.env,
            transport: 'sdk',
            // SDK dispatch returns structured output to its caller. Library-owned
            // workflow progress must never write to process stdout, which may be
            // carrying a framed protocol such as MCP stdio.
            write: () => undefined,
        });
    }
    if (this.content instanceof MissingTreeDxContentBackend) {
        const input = (request.input ?? {}) as SdkGetRequest & SdkSearchRequest;
        if (request.operation === 'read' || request.operation === 'get') {
            const definition = resolveModelDefinition(input.model, this.models);
            const payload = await this.localContentStore.get({
                ...input,
                model: definition.name,
            });
            return this.envelope(definition.name, request.operation === 'read' ? 'read' : 'get', payload);
        }
        if (request.operation === 'search') {
            const definition = resolveModelDefinition(input.model, this.models);
            const payload = await this.localContentStore.search({
                ...input,
                model: definition.name,
            });
            return this.envelope(definition.name, 'search', payload, {
                count: payload.length,
            });
        }
    }
    return executeSdkOperation(this, request.operation, request.input ?? {});
}
