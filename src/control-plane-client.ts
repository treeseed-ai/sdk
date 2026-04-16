import type {
	AgentPool,
	AgentPoolRegistration,
	AgentPoolScaleDecision,
	CatalogArtifactVersion,
	CatalogItem,
	CatalogItemFilters,
	CreateProjectDeploymentRequest,
	PriorityOverride,
	PrioritySnapshot,
	ProjectDeployment,
	ProjectEnvironment,
	ProjectEnvironmentName,
	ProjectHosting,
	ProjectInfrastructureResource,
	ProjectWorkdaySummary,
	RecordAgentPoolRegistrationRequest,
	ScaleDecision,
	TeamStorageLocator,
	UpsertAgentPoolRequest,
	UpsertCatalogArtifactVersionRequest,
	UpsertCatalogItemRequest,
	UpsertProjectEnvironmentRequest,
	UpsertProjectHostingRequest,
	UpsertProjectInfrastructureResourceRequest,
	UpsertTeamStorageLocatorRequest,
	WorkdayPolicy,
	SdkPriorityOverrideRequest,
	SdkUpsertWorkPolicyRequest,
} from './sdk-types.ts';

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
		method: 'GET' | 'POST' | 'PUT',
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
		return payload.payload;
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
}
