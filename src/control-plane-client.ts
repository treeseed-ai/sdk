import type {
	AgentPool,
	AgentPoolRegistration,
	AgentPoolScaleDecision,
	ApprovalRequest,
	CapacityGrant,
	CapacityPlan,
	CapacityProvider,
	CapacityProviderLane,
	CapacityProviderRotateKeyResponse,
	CapacityReservation,
	CapacityRoutingDecision,
	CatalogArtifactVersion,
	CatalogItem,
	CatalogItemFilters,
	CreateApprovalRequestRequest,
	CreateCapacityProviderRequest,
	CreateCapacityProviderResponse,
	CreateCapacityReservationRequest,
	CreateCapacityRoutingDecisionRequest,
	CreateProjectDeploymentRequest,
	CreateTaskEstimateRequest,
	CreateTaskUsageActualRequest,
	PriorityOverride,
	PrioritySnapshot,
	ProjectConnection,
	ProjectDeployment,
	ProjectEnvironment,
	ProjectEnvironmentName,
	ProjectHosting,
	ProjectInfrastructureResource,
	ProjectWorkdaySummary,
	RecordAgentPoolRegistrationRequest,
	RecordCapacityUsageRequest,
	RenameCapacityProviderRequest,
	RepositoryClaim,
	RunnerScaleDecision,
	ScaleDecision,
	SdkAppendTaskEventRequest,
	SdkClaimTaskRequest,
	SdkClaimWorkdayManagerLeaseRequest,
	SdkCloseWorkDayRequest,
	SdkCompleteTaskRequest,
	SdkCreateTaskRequest,
	SdkFailTaskRequest,
	SdkManagerContextPayload,
	SdkRecordRepositoryClaimRequest,
	SdkRecordRunnerScaleDecisionRequest,
	SdkRecordWorkerRunnerRequest,
	SdkReleaseWorkdayManagerLeaseRequest,
	SdkStartWorkDayRequest,
	SdkTaskEntity,
	SdkTaskEventEntity,
	SdkTaskOutputEntity,
	SdkTaskProgressRequest,
	SdkTaskSearchRequest,
	SdkCreateWorkdayRequest,
	SdkWorkDayEntity,
	TeamStorageLocator,
	TeamWebHost,
	TaskEstimate,
	UpsertAgentPoolRequest,
	UpsertCapacityGrantRequest,
	UpsertCapacityProviderLaneRequest,
	UpsertCapacityProviderRequest,
	UpsertCatalogArtifactVersionRequest,
	UpsertCatalogItemRequest,
	UpsertProjectEnvironmentRequest,
	UpsertProjectHostingRequest,
	UpsertProjectInfrastructureResourceRequest,
	UpsertTeamStorageLocatorRequest,
	UpsertTeamWebHostRequest,
	WorkdayPolicy,
	WorkdayManagerLease,
	WorkdayRequest,
	WorkerRunner,
	SdkPriorityOverrideRequest,
	SdkUpsertWorkPolicyRequest,
} from './sdk-types.ts';
import type {
	AgentMessageRecord,
	AgentStatusRecord,
	DirectBoardItemSummary,
	InboxItem,
	LaunchProjectRequest,
	LaunchProjectResult,
	ProjectOverviewSummary,
	ReleaseDetail,
	ReleaseSummary,
	SharePackageStatus,
	TeamHomeSummary,
	TeamMemberSummary,
	WorkstreamDetail,
	WorkstreamSummary,
} from './project-workflow.ts';

type JsonEnvelope<TPayload> = {
	ok: boolean;
	payload: TPayload;
};

export interface ControlPlaneClientOptions {
	baseUrl: string;
	accessToken?: string | null;
	fetchImpl?: typeof fetch;
}

function normalizeBaseUrl(value: string) {
	return value.trim().replace(/\/+$/u, '');
}

export class ControlPlaneClient {
	private readonly baseUrl: string;
	private readonly accessToken: string | null;
	private readonly fetchImpl: typeof fetch;

	constructor(options: ControlPlaneClientOptions) {
		this.baseUrl = normalizeBaseUrl(options.baseUrl);
		this.accessToken = typeof options.accessToken === 'string' && options.accessToken.trim()
			? options.accessToken.trim()
			: null;
		this.fetchImpl = options.fetchImpl ?? fetch;
	}

	private requestUrl(pathname: string, query?: Record<string, string | null | undefined>) {
		const url = new URL(pathname, `${this.baseUrl}/`);
		for (const [key, value] of Object.entries(query ?? {})) {
			if (typeof value === 'string' && value.trim()) {
				url.searchParams.set(key, value);
			}
		}
		return url;
	}

	private async requestJson<TPayload>(
		method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
		pathname: string,
		options: {
			query?: Record<string, string | null | undefined>;
			body?: Record<string, unknown>;
		} = {},
	): Promise<TPayload> {
		const headers = new Headers({
			accept: 'application/json',
		});
		if (this.accessToken) {
			headers.set('authorization', `Bearer ${this.accessToken}`);
		}
		if (options.body) {
			headers.set('content-type', 'application/json');
		}

		const response = await this.fetchImpl(this.requestUrl(pathname, options.query), {
			method,
			headers,
			body: options.body ? JSON.stringify(options.body) : undefined,
		});
		if (!response.ok) {
			throw new Error(`Control-plane request failed for ${pathname}: ${response.status} ${response.statusText}`);
		}
		const payload = await response.json() as JsonEnvelope<TPayload>;
		if (!payload.ok) {
			throw new Error(`Control-plane request returned a non-ok envelope for ${pathname}.`);
		}
		return Object.prototype.hasOwnProperty.call(payload, 'payload')
			? payload.payload
			: payload as unknown as TPayload;
	}

	listCatalogItems(filters: CatalogItemFilters = {}) {
		return this.requestJson<CatalogItem[]>('GET', '/v1/catalog', {
			query: {
				kind: filters.kind ?? null,
				teamId: filters.teamId ?? null,
				slug: filters.slug ?? null,
			},
		});
	}

	getCatalogItem(itemId: string) {
		return this.requestJson<CatalogItem>('GET', `/v1/catalog/${encodeURIComponent(itemId)}`);
	}

	listCatalogArtifactVersions(itemId: string) {
		return this.requestJson<CatalogArtifactVersion[]>('GET', `/v1/catalog/${encodeURIComponent(itemId)}/artifacts`);
	}

	upsertCatalogItem(teamId: string, input: UpsertCatalogItemRequest) {
		return this.requestJson<CatalogItem>('POST', `/v1/teams/${encodeURIComponent(teamId)}/catalog-items`, { body: input });
	}

	upsertCatalogArtifactVersion(itemId: string, input: UpsertCatalogArtifactVersionRequest) {
		return this.requestJson<CatalogArtifactVersion>('POST', `/v1/catalog/${encodeURIComponent(itemId)}/artifacts`, { body: input });
	}

	getTeamStorageLocator(teamId: string) {
		return this.requestJson<TeamStorageLocator | null>('GET', `/v1/teams/${encodeURIComponent(teamId)}/storage`);
	}

	upsertTeamStorageLocator(teamId: string, input: UpsertTeamStorageLocatorRequest) {
		return this.requestJson<TeamStorageLocator>('PUT', `/v1/teams/${encodeURIComponent(teamId)}/storage`, { body: input });
	}

	getProjectHosting(projectId: string) {
		return this.requestJson<ProjectHosting | null>('GET', `/v1/projects/${encodeURIComponent(projectId)}/hosting`);
	}

	upsertProjectConnection(projectId: string, input: {
		mode: string;
		projectApiBaseUrl?: string | null;
		executionOwner?: string | null;
		metadata?: Record<string, unknown>;
		rotateRunnerToken?: boolean;
	}) {
		return this.requestJson<{
			connection: ProjectConnection | null;
			runnerToken: string | null;
		}>('POST', `/v1/projects/${encodeURIComponent(projectId)}/connection`, {
			body: input as Record<string, unknown>,
		});
	}

	upsertProjectHosting(projectId: string, input: UpsertProjectHostingRequest) {
		return this.requestJson<ProjectHosting>('PUT', `/v1/projects/${encodeURIComponent(projectId)}/hosting`, { body: input });
	}

	listProjectEnvironments(projectId: string) {
		return this.requestJson<ProjectEnvironment[]>('GET', `/v1/projects/${encodeURIComponent(projectId)}/environments`);
	}

	upsertProjectEnvironment(projectId: string, environment: ProjectEnvironmentName, input: UpsertProjectEnvironmentRequest) {
		return this.requestJson<ProjectEnvironment>(
			'PUT',
			`/v1/projects/${encodeURIComponent(projectId)}/environments/${encodeURIComponent(environment)}`,
			{ body: input },
		);
	}

	listProjectInfrastructureResources(projectId: string, environment?: ProjectEnvironmentName | null) {
		return this.requestJson<ProjectInfrastructureResource[]>(
			'GET',
			`/v1/projects/${encodeURIComponent(projectId)}/resources`,
			{ query: { environment: environment ?? null } },
		);
	}

	upsertProjectInfrastructureResource(projectId: string, input: UpsertProjectInfrastructureResourceRequest) {
		return this.requestJson<ProjectInfrastructureResource>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/resources`,
			{ body: input },
		);
	}

	listProjectDeployments(projectId: string, environment?: ProjectEnvironmentName | null) {
		return this.requestJson<ProjectDeployment[]>(
			'GET',
			`/v1/projects/${encodeURIComponent(projectId)}/deployments`,
			{ query: { environment: environment ?? null } },
		);
	}

	createProjectDeployment(projectId: string, input: CreateProjectDeploymentRequest) {
		return this.requestJson<ProjectDeployment>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/deployments`,
			{ body: input as Record<string, unknown> },
		);
	}

	listAgentPools(projectId: string, environment?: ProjectEnvironmentName | null) {
		return this.requestJson<AgentPool[]>(
			'GET',
			`/v1/projects/${encodeURIComponent(projectId)}/agent-pools`,
			{ query: { environment: environment ?? null } },
		);
	}

	upsertAgentPool(projectId: string, input: UpsertAgentPoolRequest) {
		return this.requestJson<AgentPool>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/agent-pools`,
			{ body: input as Record<string, unknown> },
		);
	}

	listAgentPoolRegistrations(projectId: string, poolId: string) {
		return this.requestJson<AgentPoolRegistration[]>(
			'GET',
			`/v1/projects/${encodeURIComponent(projectId)}/agent-pools/${encodeURIComponent(poolId)}/registrations`,
		);
	}

	listAgentPoolScaleDecisions(projectId: string, poolId: string) {
		return this.requestJson<AgentPoolScaleDecision[]>(
			'GET',
			`/v1/projects/${encodeURIComponent(projectId)}/agent-pools/${encodeURIComponent(poolId)}/scale-decisions`,
		);
	}

	getProjectWorkPolicy(projectId: string, environment: ProjectEnvironmentName = 'staging') {
		return this.requestJson<WorkdayPolicy | null>(
			'GET',
			`/v1/projects/${encodeURIComponent(projectId)}/work-policy`,
			{ query: { environment } },
		);
	}

	upsertProjectWorkPolicy(projectId: string, input: SdkUpsertWorkPolicyRequest) {
		return this.requestJson<WorkdayPolicy>(
			'PUT',
			`/v1/projects/${encodeURIComponent(projectId)}/work-policy`,
			{ body: input as Record<string, unknown> },
		);
	}

	getProjectWorkdayPolicy(projectId: string, environment: ProjectEnvironmentName = 'staging') {
		return this.requestJson<WorkdayPolicy | null>(
			'GET',
			`/v1/projects/${encodeURIComponent(projectId)}/workday-policy`,
			{ query: { environment } },
		);
	}

	upsertProjectWorkdayPolicy(projectId: string, input: SdkUpsertWorkPolicyRequest) {
		return this.requestJson<WorkdayPolicy>(
			'PUT',
			`/v1/projects/${encodeURIComponent(projectId)}/workday-policy`,
			{ body: input as Record<string, unknown> },
		);
	}

	getProjectWorkdayStatus(projectId: string, environment: ProjectEnvironmentName = 'staging') {
		return this.requestJson<Record<string, unknown>>(
			'GET',
			`/v1/projects/${encodeURIComponent(projectId)}/workday-status`,
			{ query: { environment } },
		);
	}

	startRunnerWorkday(projectId: string, input: SdkStartWorkDayRequest & { environment?: string | null }) {
		return this.requestJson<SdkWorkDayEntity>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/workdays/start`,
			{ body: input as Record<string, unknown> },
		);
	}

	closeRunnerWorkday(projectId: string, input: SdkCloseWorkDayRequest & { environment?: string | null }) {
		return this.requestJson<SdkWorkDayEntity>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/workdays/${encodeURIComponent(input.id)}/close`,
			{ body: input as Record<string, unknown> },
		);
	}

	listRunnerWorkdays(projectId: string, input: { state?: string | null; limit?: number | null } = {}) {
		return this.requestJson<SdkWorkDayEntity[]>(
			'GET',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/workdays/runtime`,
			{
				query: {
					state: input.state ?? null,
					limit: input.limit ? String(input.limit) : null,
				},
			},
		);
	}

	createRunnerTask(projectId: string, input: SdkCreateTaskRequest) {
		return this.requestJson<SdkTaskEntity>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/tasks`,
			{ body: input as Record<string, unknown> },
		);
	}

	listRunnerTasks(projectId: string, input: SdkTaskSearchRequest = {}) {
		return this.requestJson<SdkTaskEntity[]>(
			'GET',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/tasks`,
			{
				query: {
					workDayId: input.workDayId ?? null,
					agentId: input.agentId ?? null,
					state: Array.isArray(input.state) ? input.state.join(',') : input.state ?? null,
					limit: input.limit ? String(input.limit) : null,
				},
			},
		);
	}

	claimRunnerTask(projectId: string, taskId: string, input: Omit<SdkClaimTaskRequest, 'id'>) {
		return this.requestJson<SdkTaskEntity | null>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/tasks/${encodeURIComponent(taskId)}/claim`,
			{ body: input as Record<string, unknown> },
		);
	}

	recordRunnerTaskProgress(projectId: string, taskId: string, input: Omit<SdkTaskProgressRequest, 'id'>) {
		return this.requestJson<SdkTaskEntity | null>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/tasks/${encodeURIComponent(taskId)}/progress`,
			{ body: input as Record<string, unknown> },
		);
	}

	appendRunnerTaskEvent(projectId: string, taskId: string, input: Omit<SdkAppendTaskEventRequest, 'taskId'>) {
		return this.requestJson<SdkTaskEventEntity | null>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/tasks/${encodeURIComponent(taskId)}/events`,
			{ body: input as Record<string, unknown> },
		);
	}

	completeRunnerTask(projectId: string, taskId: string, input: Omit<SdkCompleteTaskRequest, 'id'>) {
		return this.requestJson<SdkTaskEntity | null>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/tasks/${encodeURIComponent(taskId)}/complete`,
			{ body: input as Record<string, unknown> },
		);
	}

	failRunnerTask(projectId: string, taskId: string, input: Omit<SdkFailTaskRequest, 'id'>) {
		return this.requestJson<SdkTaskEntity | null>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/tasks/${encodeURIComponent(taskId)}/fail`,
			{ body: input as Record<string, unknown> },
		);
	}

	getRunnerTaskContext(projectId: string, taskId: string) {
		return this.requestJson<SdkManagerContextPayload>(
			'GET',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/tasks/${encodeURIComponent(taskId)}/context`,
		);
	}

	listRunnerTaskEvents(projectId: string, taskId: string) {
		return this.requestJson<SdkTaskEventEntity[]>(
			'GET',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/tasks/${encodeURIComponent(taskId)}/events`,
		);
	}

	listRunnerTaskOutputs(projectId: string, taskId: string) {
		return this.requestJson<SdkTaskOutputEntity[]>(
			'GET',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/tasks/${encodeURIComponent(taskId)}/outputs`,
		);
	}

	storeRunnerArtifact(projectId: string, input: {
		objectKey?: string | null;
		content?: string | Record<string, unknown> | null;
		contentBase64?: string | null;
		contentType?: string | null;
		sha256?: string | null;
	}) {
		return this.requestJson<{
			artifactStorage: string;
			storageMode: string;
			outputRef: string;
			objectKey: string;
			contentType: string;
			sizeBytes: number;
			sha256: string;
			teamId: string;
			projectId: string;
			createdAt: string;
		}>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/artifacts`,
			{ body: input as Record<string, unknown> },
		);
	}

	claimRunnerManagerLease(projectId: string, input: SdkClaimWorkdayManagerLeaseRequest) {
		return this.requestJson<WorkdayManagerLease | null>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/manager-leases/claim`,
			{ body: input as Record<string, unknown> },
		);
	}

	releaseRunnerManagerLease(projectId: string, input: SdkReleaseWorkdayManagerLeaseRequest) {
		return this.requestJson<WorkdayManagerLease | null>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/manager-leases/${encodeURIComponent(input.id)}/release`,
			{ body: input as Record<string, unknown> },
		);
	}

	listRunnerManagerLeases(projectId: string, environment: ProjectEnvironmentName | 'local' = 'staging') {
		return this.requestJson<WorkdayManagerLease[]>(
			'GET',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/manager-leases`,
			{ query: { environment } },
		);
	}

	createProjectWorkdayRequest(projectId: string, input: SdkCreateWorkdayRequest) {
		return this.requestJson<WorkdayRequest>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/workday-requests`,
			{ body: input as Record<string, unknown> },
		);
	}

	listProjectPriorityOverrides(projectId: string) {
		return this.requestJson<PriorityOverride[]>(
			'GET',
			`/v1/projects/${encodeURIComponent(projectId)}/priority-overrides`,
		);
	}

	upsertProjectPriorityOverride(projectId: string, input: SdkPriorityOverrideRequest) {
		return this.requestJson<PriorityOverride>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/priority-overrides`,
			{ body: input as Record<string, unknown> },
		);
	}

	listProjectPrioritySnapshots(projectId: string, workDayId?: string | null) {
		return this.requestJson<PrioritySnapshot[]>(
			'GET',
			`/v1/projects/${encodeURIComponent(projectId)}/priority-snapshots`,
			{ query: { workDayId: workDayId ?? null } },
		);
	}

	recordRunnerEnvironment(projectId: string, environment: ProjectEnvironmentName, input: UpsertProjectEnvironmentRequest) {
		return this.requestJson<ProjectEnvironment>(
			'PUT',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/environments/${encodeURIComponent(environment)}`,
			{ body: input },
		);
	}

	recordRunnerInfrastructureResource(projectId: string, input: UpsertProjectInfrastructureResourceRequest) {
		return this.requestJson<ProjectInfrastructureResource>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/resources`,
			{ body: input as Record<string, unknown> },
		);
	}

	recordRunnerDeployment(projectId: string, input: CreateProjectDeploymentRequest) {
		return this.requestJson<ProjectDeployment>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/deployments`,
			{ body: input as Record<string, unknown> },
		);
	}

	listRunnerDeployments(projectId: string, environment?: ProjectEnvironmentName | null) {
		return this.requestJson<ProjectDeployment[]>(
			'GET',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/deployments`,
			{ query: { environment: environment ?? null } },
		);
	}

	recordRunnerAgentPoolRegistration(projectId: string, poolId: string, input: RecordAgentPoolRegistrationRequest) {
		return this.requestJson<AgentPoolRegistration>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/agent-pools/${encodeURIComponent(poolId)}/register`,
			{ body: input as Record<string, unknown> },
		);
	}

	recordRunnerScaleDecision(projectId: string, poolName: string, input: Pick<ScaleDecision, 'environment' | 'workDayId' | 'desiredWorkers' | 'observedQueueDepth' | 'observedActiveLeases' | 'reason' | 'metadata'>) {
		return this.requestJson<AgentPoolScaleDecision>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/agent-pools/${encodeURIComponent(poolName)}/scale-decisions`,
			{ body: input as Record<string, unknown> },
		);
	}

	recordRunnerWorkdaySummary(projectId: string, input: ProjectWorkdaySummary) {
		return this.requestJson<ProjectWorkdaySummary>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/workdays`,
			{ body: input as Record<string, unknown> },
		);
	}

	recordWorkerRunner(projectId: string, input: SdkRecordWorkerRunnerRequest) {
		return this.requestJson<WorkerRunner>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/worker-runners`,
			{ body: input as Record<string, unknown> },
		);
	}

	listWorkerRunners(projectId: string, environment: ProjectEnvironmentName = 'staging') {
		return this.requestJson<WorkerRunner[]>(
			'GET',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/worker-runners`,
			{ query: { environment } },
		);
	}

	recordRepositoryClaim(projectId: string, input: SdkRecordRepositoryClaimRequest) {
		return this.requestJson<RepositoryClaim>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/repository-claims`,
			{ body: input as Record<string, unknown> },
		);
	}

	listRepositoryClaims(projectId: string, repositoryId?: string | null) {
		return this.requestJson<RepositoryClaim[]>(
			'GET',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/repository-claims`,
			{ query: { repositoryId: repositoryId ?? null } },
		);
	}

	reportRunnerCapacityUsage(projectId: string, input: RecordCapacityUsageRequest) {
		return this.requestJson<{ entry: unknown; settlement?: unknown; usageActual?: unknown }>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/capacity/usage`,
			{ body: input as Record<string, unknown> },
		);
	}

	createRunnerApprovalRequest(projectId: string, input: Omit<CreateApprovalRequestRequest, 'projectId'> & Partial<Pick<CreateApprovalRequestRequest, 'projectId'>>) {
		return this.requestJson<ApprovalRequest>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/approval-requests`,
			{ body: input as Record<string, unknown> },
		);
	}

	recordRunnerScaleDecisionV2(projectId: string, input: SdkRecordRunnerScaleDecisionRequest) {
		return this.requestJson<RunnerScaleDecision>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/runner-scale-decisions`,
			{ body: input as Record<string, unknown> },
		);
	}

	getTeamHomeSummary(teamId: string) {
		return this.requestJson<TeamHomeSummary>('GET', `/v1/teams/${encodeURIComponent(teamId)}/home`);
	}

	listTeamInboxItems(teamId: string) {
		return this.requestJson<InboxItem[]>('GET', `/v1/teams/${encodeURIComponent(teamId)}/inbox`);
	}

	listTeamMembers(teamId: string) {
		return this.requestJson<TeamMemberSummary[]>('GET', `/v1/teams/${encodeURIComponent(teamId)}/members`);
	}

	listTeamWebHosts(teamId: string) {
		return this.requestJson<TeamWebHost[]>('GET', `/v1/teams/${encodeURIComponent(teamId)}/hosts`);
	}

	createTeamWebHost(teamId: string, input: UpsertTeamWebHostRequest) {
		return this.requestJson<TeamWebHost>('POST', `/v1/teams/${encodeURIComponent(teamId)}/hosts`, {
			body: input as Record<string, unknown>,
		});
	}

	updateTeamWebHost(teamId: string, hostId: string, input: Partial<UpsertTeamWebHostRequest>) {
		return this.requestJson<TeamWebHost>('PUT', `/v1/teams/${encodeURIComponent(teamId)}/hosts/${encodeURIComponent(hostId)}`, {
			body: input as Record<string, unknown>,
		});
	}

	deleteTeamWebHost(teamId: string, hostId: string) {
		return this.requestJson<{ ok: boolean; payload?: TeamWebHost; error?: string }>('DELETE', `/v1/teams/${encodeURIComponent(teamId)}/hosts/${encodeURIComponent(hostId)}`);
	}

	validateTeamWebHost(teamId: string, hostId: string, input: { decryptedConfig?: Record<string, unknown> | null }) {
		return this.requestJson<{ host: TeamWebHost; validation: Record<string, unknown> | null }>(
			'POST',
			`/v1/teams/${encodeURIComponent(teamId)}/hosts/${encodeURIComponent(hostId)}/validate`,
			{ body: input },
		);
	}

	listCapacityProviders(teamId: string) {
		return this.requestJson<Array<CapacityProvider & { lanes?: CapacityProviderLane[] }>>(
			'GET',
			`/v1/teams/${encodeURIComponent(teamId)}/capacity-providers`,
		);
	}

	createCapacityProvider(teamId: string, input: UpsertCapacityProviderRequest) {
		return this.requestJson<CreateCapacityProviderResponse>('POST', `/v1/teams/${encodeURIComponent(teamId)}/capacity-providers`, {
			body: input as unknown as Record<string, unknown>,
		});
	}

	createCapacityProviderRegistration(teamId: string, input: CreateCapacityProviderRequest) {
		return this.requestJson<CreateCapacityProviderResponse>('POST', `/v1/teams/${encodeURIComponent(teamId)}/capacity-providers`, {
			body: input as Record<string, unknown>,
		});
	}

	updateCapacityProvider(teamId: string, providerId: string, input: Partial<UpsertCapacityProviderRequest> | RenameCapacityProviderRequest) {
		return this.requestJson<{ ok: true; provider: CapacityProvider }>(
			'PATCH',
			`/v1/teams/${encodeURIComponent(teamId)}/capacity-providers/${encodeURIComponent(providerId)}`,
			{ body: input as Record<string, unknown> },
		);
	}

	rotateCapacityProviderApiKey(teamId: string, providerId: string) {
		return this.requestJson<CapacityProviderRotateKeyResponse>(
			'POST',
			`/v1/teams/${encodeURIComponent(teamId)}/capacity-providers/${encodeURIComponent(providerId)}/keys/rotate`,
		);
	}

	listCapacityProviderLanes(teamId: string, providerId: string) {
		return this.requestJson<CapacityProviderLane[]>(
			'GET',
			`/v1/teams/${encodeURIComponent(teamId)}/capacity-providers/${encodeURIComponent(providerId)}/lanes`,
		);
	}

	createCapacityProviderLane(teamId: string, providerId: string, input: UpsertCapacityProviderLaneRequest) {
		return this.requestJson<CapacityProviderLane>(
			'POST',
			`/v1/teams/${encodeURIComponent(teamId)}/capacity-providers/${encodeURIComponent(providerId)}/lanes`,
			{ body: input as Record<string, unknown> },
		);
	}

	listCapacityGrants(teamId: string, input: { projectId?: string | null; providerId?: string | null } = {}) {
		return this.requestJson<CapacityGrant[]>('GET', `/v1/teams/${encodeURIComponent(teamId)}/capacity-grants`, {
			query: {
				projectId: input.projectId ?? null,
				providerId: input.providerId ?? null,
			},
		});
	}

	createCapacityGrant(teamId: string, input: UpsertCapacityGrantRequest) {
		return this.requestJson<CapacityGrant>('POST', `/v1/teams/${encodeURIComponent(teamId)}/capacity-grants`, {
			body: input as Record<string, unknown>,
		});
	}

	getProjectCapacityPlan(projectId: string, environment?: ProjectEnvironmentName | 'local' | null) {
		return this.requestJson<CapacityPlan>('GET', `/v1/projects/${encodeURIComponent(projectId)}/capacity-plan`, {
			query: { environment: environment ?? null },
		});
	}

	recordRunnerCapacityEstimate(projectId: string, input: CreateTaskEstimateRequest | { estimates: CreateTaskEstimateRequest[] }) {
		return this.requestJson<TaskEstimate | TaskEstimate[]>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/capacity/estimates`,
			{ body: input as unknown as Record<string, unknown> },
		);
	}

	createRunnerCapacityReservation(projectId: string, input: CreateCapacityReservationRequest) {
		return this.requestJson<CapacityReservation>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/capacity/reservations`,
			{ body: input as Record<string, unknown> },
		);
	}

	recordRunnerCapacityUsage(projectId: string, input: RecordCapacityUsageRequest & { usageActual?: CreateTaskUsageActualRequest }) {
		return this.requestJson<{ entry: unknown; usageActual: unknown | null }>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/capacity/usage`,
			{ body: input as unknown as Record<string, unknown> },
		);
	}

	recordRunnerCapacityRoutingDecision(projectId: string, input: CreateCapacityRoutingDecisionRequest) {
		return this.requestJson<CapacityRoutingDecision>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/capacity/routing-decisions`,
			{ body: input as Record<string, unknown> },
		);
	}

	createRunnerApprovalRequest(projectId: string, input: CreateApprovalRequestRequest) {
		return this.requestJson<ApprovalRequest>(
			'POST',
			`/v1/projects/${encodeURIComponent(projectId)}/runner/approval-requests`,
			{ body: input as Record<string, unknown> },
		);
	}

	decideApprovalRequest(approvalRequestId: string, input: { state?: 'approved' | 'rejected'; optionId?: string | null; note?: string | null; decision?: Record<string, unknown> }) {
		return this.requestJson<ApprovalRequest>(
			'POST',
			`/v1/approval-requests/${encodeURIComponent(approvalRequestId)}/decide`,
			{ body: input },
		);
	}

	listTeamProducts(teamId: string) {
		return this.requestJson<CatalogItem[]>('GET', `/v1/teams/${encodeURIComponent(teamId)}/products`);
	}

	launchProject(teamId: string, input: LaunchProjectRequest) {
		return this.requestJson<LaunchProjectResult>('POST', `/v1/teams/${encodeURIComponent(teamId)}/projects/launch`, {
			body: input as Record<string, unknown>,
		});
	}

	getProjectSummary(projectId: string) {
		return this.requestJson<ProjectOverviewSummary>('GET', `/v1/projects/${encodeURIComponent(projectId)}/summary`);
	}

	getProjectDirectSummary(projectId: string) {
		return this.requestJson<{
			projectId: string;
			objectiveCount: number;
			questionCount: number;
			noteCount: number;
			proposalCount: number;
			decisionCount: number;
			savedViews: string[];
			items: DirectBoardItemSummary[];
		}>('GET', `/v1/projects/${encodeURIComponent(projectId)}/direct`);
	}

	listProjectWorkstreams(projectId: string) {
		return this.requestJson<{
			projectId: string;
			items: WorkstreamSummary[];
			columns: string[];
		}>('GET', `/v1/projects/${encodeURIComponent(projectId)}/workstreams`);
	}

	getProjectWorkstream(projectId: string, workstreamId: string) {
		return this.requestJson<WorkstreamDetail>('GET', `/v1/projects/${encodeURIComponent(projectId)}/workstreams/${encodeURIComponent(workstreamId)}`);
	}

	listProjectReleases(projectId: string) {
		return this.requestJson<{
			projectId: string;
			history: ReleaseSummary[];
			currentProd: ReleaseSummary | null;
			stagingCandidates: ReleaseSummary[];
		}>('GET', `/v1/projects/${encodeURIComponent(projectId)}/releases`);
	}

	getProjectRelease(projectId: string, releaseId: string) {
		return this.requestJson<ReleaseDetail>('GET', `/v1/projects/${encodeURIComponent(projectId)}/releases/${encodeURIComponent(releaseId)}`);
	}

	getProjectAgents(projectId: string) {
		return this.requestJson<{
			projectId: string;
			agents: AgentStatusRecord[];
		}>('GET', `/v1/projects/${encodeURIComponent(projectId)}/agents`);
	}

	listProjectAgentMessages(projectId: string) {
		return this.requestJson<AgentMessageRecord[]>('GET', `/v1/projects/${encodeURIComponent(projectId)}/agents/messages`);
	}

	getProjectShare(projectId: string) {
		return this.requestJson<{
			projectId: string;
			packages: SharePackageStatus[];
			listing: CatalogItem | null;
			canPublish: boolean;
		}>('GET', `/v1/projects/${encodeURIComponent(projectId)}/share`);
	}

	approveJob(jobId: string, note?: string | null) {
		return this.requestJson<{ id: string; status: string }>('POST', `/v1/jobs/${encodeURIComponent(jobId)}/approve`, {
			body: note ? { note } : {},
		});
	}

	rejectJob(jobId: string, reason: string) {
		return this.requestJson<{ id: string; status: string }>('POST', `/v1/jobs/${encodeURIComponent(jobId)}/reject`, {
			body: { reason },
		});
	}
}
