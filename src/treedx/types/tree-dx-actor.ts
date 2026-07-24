import type {
	SdkContextPack,
	SdkContextPackRequest,
	SdkGraphDslParseResult,
	SdkGraphEdge,
	SdkGraphNode,
	SdkGraphQueryRequest,
	SdkGraphQueryResult,
	SdkGraphRefreshPayload,
	SdkGraphRefreshRequest,
	SdkGraphSearchOptions,
	SdkGraphSearchResult,
	SdkGraphTraversalResult,
} from '../../entrypoints/models/sdk-types.ts';
import type { components, operations, paths } from '../generated/openapi-types.ts';


export interface TreeDxActor {
	actorId: string;
	tenantId: string;
}

export interface TreeDxClientOptions {
	baseUrl: string;
	token?: string;
	repoId?: string;
	fetch?: typeof fetch;
	defaultRef?: string;
	defaultActor?: TreeDxActor;
	timeoutMs?: number;
}

export type TreeDxErrorCode =
	| components['schemas']['TreeDxErrorCode']
	| 'missing_repo_id'
	| 'missing_token'
	| 'invalid_response'
	| 'treedx_api_error'
	| 'model_not_content_backed'
	| 'operation_not_allowed'
	| 'missing_content_path_mapping'
	| 'not_implemented'
	| 'workspace_required'
	| 'node_not_configured'
	| 'unsupported_treedx_graph_operation'
	| (string & {});

export interface TreeDxOkEnvelope<T> {
	ok: true;
	[key: string]: unknown;
}

export interface TreeDxErrorBody {
	code: string;
	message: string;
	details?: Record<string, unknown>;
}

export interface TreeDxErrorEnvelope {
	ok: false;
	error: TreeDxErrorBody;
}

export function assertTreeDxOk<T extends Record<string, unknown>>(
	value: unknown,
	label = 'TreeDX response',
): asserts value is T & { ok: true } {
	if (typeof value !== 'object' || value === null || Array.isArray(value) || (value as { ok?: unknown }).ok !== true) {
		throw new Error(`${label} was not an ok TreeDX response.`);
	}
}

export interface TreeDxHealth {
	status: string;
	service: string;
	dataDir?: string;
}

export type TreeDxReadiness = components['schemas']['TreeDxReadiness'];

export type TreeDxDeepHealth = components['schemas']['TreeDxHealthSummary'];

export type TreeDxMetrics = components['schemas']['TreeDxMetrics'];

export interface TreeDxVersion {
	service: string;
	version: string;
	apiVersion: string;
}

export interface TreeDxPrincipal {
	actorId: string;
	tenantId: string;
	authMode?: string;
}

export interface TreeDxWhoami {
	authenticated: boolean;
	principal: TreeDxPrincipal | null;
}

export interface TreeDxEffectiveScopeRequest {
	repoId?: string;
}

export interface TreeDxEffectiveScope {
	actorId: string;
	tenantIds: string[];
	repoId?: string | null;
	capabilities: string[];
	refs: string[];
	paths: string[];
	policyVersion?: string;
	policyHash?: string;
}

export interface TreeDxAuthMode {
	mode: 'dev' | 'connected';
	connected: boolean;
	verifier?: {
		type: 'jwt_hs256' | 'hs256_dev' | 'jwks_oidc' | 'trusted_internal';
		issuer?: string;
		jwksUrl?: string;
	};
}

export interface TreeDxCapabilityGrant {
	id?: string;
	actorId: string;
	tenantId: string;
	repoIds: string[];
	capabilities: string[];
	refs: string[];
	paths: string[];
	expiresAt?: string | null;
	revokedAt?: string | null;
	revokedByActorId?: string | null;
	revocationReason?: string | null;
}

export interface TreeDxAuditEvent {
	id: string;
	eventType: string;
	actorId?: string | null;
	tenantId?: string | null;
	repoId?: string | null;
	nodeId?: string | null;
	workspaceId?: string | null;
	operation?: string | null;
	status?: string | null;
	requestId?: string | null;
	requestedScope?: Record<string, unknown> | null;
	effectiveScope?: Record<string, unknown> | null;
	data: Record<string, unknown>;
	recordedAt: string;
}

export interface TreeDxFederationQueryPlanRequest {
	repoIds: string[];
	refs?: Record<string, string>;
	paths?: Record<string, string[]>;
	queryType?: string;
	capabilities?: string[];
}

export interface TreeDxFederationQueryPlan {
	requestedScope: Record<string, unknown>;
	effectiveScope: Record<string, unknown>;
	rejected: Array<Record<string, unknown>>;
	executable: false;
	reason: string;
}

export interface TreeDxNode {
	id: string;
	baseUrl: string;
	role: string;
	health: string;
}

export interface TreeDxRepositoryPlacement {
	repositoryId?: string;
	repoId?: string;
	primaryNodeId: string;
	mirrorNodeIds: string[];
	readPolicy: string;
	writePolicy: string;
	migrationState: string;
}

export interface TreeDxMirror {
	id?: string;
	repositoryId?: string;
	repoId?: string;
	sourceNodeId: string;
	targetNodeId: string;
	mode: string;
	lastSeenCommit?: string | null;
	behindBy?: number | null;
	status: string;
}

export interface TreeDxRepository {
	repoId: string;
	name: string;
	repositoryName?: string;
	defaultRef: string;
	status: string;
	remoteUrl?: string | null;
}

export interface TreeDxRegisterRepositoryRequest {
	name: string;
	repositoryName?: string;
	createIfMissing?: boolean;
	defaultRef?: string;
	metadata?: Record<string, unknown>;
}

export interface TreeDxRef {
	name: string;
	target?: string | null;
	sha?: string | null;
	kind: string;
}

export interface TreeDxRemote {
	name: string;
	url?: string | null;
}

export interface TreeDxRepositoryStatus {
	repo: TreeDxRepository;
	git: Record<string, unknown>;
	placement?: TreeDxRepositoryPlacement | null;
}

export interface TreeDxCreateWorkspaceRequest {
	repoId?: string;
	baseRef?: string;
	branchName?: string;
	mode?: 'writable' | 'read_only';
	allowedPaths?: string[];
	ttlSeconds?: number;
}

export interface TreeDxWorkspace {
	workspaceId: string;
	repoId: string;
	baseRef: string;
	baseCommitSha: string;
	branchName?: string | null;
	mode: 'writable' | 'read_only';
	status: string;
	allowedPaths: string[];
	commitSha?: string | null;
	policyVersion?: string;
	policyHash?: string;
	revokedAt?: string | null;
	revokedReason?: string | null;
}

export interface TreeDxWorkspaceRequest {
	workspaceId: string;
}
