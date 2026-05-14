import type {
	AgentPoolAutoscalePolicy,
	ApprovalRequest,
	CapacityPlan,
	CapacityReservation,
	CapacityRoutingDecision,
	CreateApprovalRequestRequest,
	CreateCapacityReservationRequest,
	CreateCapacityRoutingDecisionRequest,
	CreateTaskEstimateRequest,
	ProjectDeploymentKind,
	ProjectDeploymentStatus,
	ProjectEnvironmentName,
	ProjectInfrastructureResourceKind,
	ProjectInfrastructureResourceProvider,
	RecordCapacityUsageRequest,
	TaskEstimate,
	TreeseedHostingKind,
	TreeseedHostingRegistration,
} from './sdk-types.ts';
import type { TreeseedDeployConfig } from './platform/contracts.ts';

export type ControlPlaneReporterKind = 'noop' | 'market_http' | 'self_http';

export interface ControlPlaneEnvironmentReport {
	environment: ProjectEnvironmentName;
	deploymentProfile: TreeseedHostingKind;
	baseUrl?: string | null;
	cloudflareAccountId?: string | null;
	pagesProjectName?: string | null;
	workerName?: string | null;
	r2BucketName?: string | null;
	d1DatabaseName?: string | null;
	queueName?: string | null;
	railwayProjectName?: string | null;
	metadata?: Record<string, unknown>;
}

export interface ControlPlaneResourceReport {
	environment: ProjectEnvironmentName;
	provider: ProjectInfrastructureResourceProvider;
	resourceKind: ProjectInfrastructureResourceKind;
	logicalName: string;
	locator?: string | null;
	metadata?: Record<string, unknown>;
}

export interface ControlPlaneDeploymentReport {
	environment: ProjectEnvironmentName;
	deploymentKind: ProjectDeploymentKind;
	status: ProjectDeploymentStatus | 'success';
	sourceRef?: string | null;
	releaseTag?: string | null;
	commitSha?: string | null;
	triggeredByType?: string | null;
	triggeredById?: string | null;
	metadata?: Record<string, unknown>;
	startedAt?: string | null;
	finishedAt?: string | null;
}

export interface ControlPlaneAgentPoolHeartbeat {
	teamId: string;
	environment: ProjectEnvironmentName;
	poolName: string;
	managerId?: string | null;
	serviceName?: string | null;
	registrationIdentity?: string | null;
	serviceBaseUrl?: string | null;
	autoscale?: AgentPoolAutoscalePolicy;
	desiredWorkers?: number | null;
	observedQueueDepth?: number | null;
	observedActiveLeases?: number | null;
	metadata?: Record<string, unknown>;
}

export interface ControlPlaneScaleDecisionReport {
	environment: ProjectEnvironmentName;
	poolName: string;
	workDayId?: string | null;
	desiredWorkers: number;
	observedQueueDepth: number;
	observedActiveLeases: number;
	reason: string;
	metadata?: Record<string, unknown>;
}

export interface ControlPlaneWorkdaySummaryReport {
	environment: ProjectEnvironmentName;
	workDayId: string;
	kind?: string;
	state?: string | null;
	startedAt?: string | null;
	endedAt?: string | null;
	summary: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export interface ControlPlaneReporter {
	readonly kind: ControlPlaneReporterKind;
	readonly enabled: boolean;
	reportEnvironment(input: ControlPlaneEnvironmentReport): Promise<void>;
	reportResource(input: ControlPlaneResourceReport): Promise<void>;
	reportDeployment(input: ControlPlaneDeploymentReport): Promise<void>;
	registerAgentPoolHeartbeat(input: ControlPlaneAgentPoolHeartbeat): Promise<void>;
	reportScaleDecision(input: ControlPlaneScaleDecisionReport): Promise<void>;
	reportWorkdaySummary(input: ControlPlaneWorkdaySummaryReport): Promise<void>;
	getProjectCapacityPlan(environment?: ProjectEnvironmentName | 'local' | null): Promise<CapacityPlan | null>;
	createCapacityReservation(input: CreateCapacityReservationRequest): Promise<CapacityReservation | null>;
	reportCapacityEstimate(input: CreateTaskEstimateRequest): Promise<TaskEstimate | null>;
	reportCapacityUsage(input: RecordCapacityUsageRequest): Promise<void>;
	reportCapacityRoutingDecision(input: CreateCapacityRoutingDecisionRequest): Promise<CapacityRoutingDecision | null>;
	createApprovalRequest(input: CreateApprovalRequestRequest): Promise<ApprovalRequest | null>;
}

export interface ControlPlaneReporterOptions {
	kind?: ControlPlaneReporterKind | null;
	projectId?: string | null;
	baseUrl?: string | null;
	runnerToken?: string | null;
	fetchImpl?: typeof fetch;
}

export interface ResolveControlPlaneReporterOptions extends ControlPlaneReporterOptions {
	hostingKind?: TreeseedHostingKind | null;
	registration?: TreeseedHostingRegistration | null;
	deployConfig?: Pick<TreeseedDeployConfig, 'hosting' | 'runtime'> | null;
}

function normalizeUrl(value: string | null | undefined) {
	const normalized = String(value ?? '').trim().replace(/\/+$/u, '');
	return normalized || null;
}

function resolveReporterKind(options: ResolveControlPlaneReporterOptions): ControlPlaneReporterKind {
	if (options.kind) {
		return options.kind;
	}

	const hostingKind = options.hostingKind
		?? options.deployConfig?.hosting?.kind
		?? ((process.env.TREESEED_HOSTING_KIND?.trim() || null) as TreeseedHostingKind | null)
		?? 'self_hosted_project';
	const registration = options.registration
		?? (options.deployConfig?.runtime?.registration === 'required' ? 'optional' : options.deployConfig?.runtime?.registration)
		?? options.deployConfig?.hosting?.registration
		?? ((process.env.TREESEED_HOSTING_REGISTRATION?.trim() || null) as TreeseedHostingRegistration | null)
		?? 'none';
	const runtimeMode = options.deployConfig?.runtime?.mode ?? null;

	if (runtimeMode === 'none') {
		return 'noop';
	}
	if (runtimeMode === 'byo_attached' || runtimeMode === 'treeseed_managed') {
		return registration === 'none' ? 'noop' : 'market_http';
	}

	if (hostingKind === 'hosted_project') {
		return 'market_http';
	}
	if (hostingKind === 'self_hosted_project' && registration === 'optional') {
		return 'market_http';
	}
	if (hostingKind === 'market_control_plane') {
		return normalizeUrl(options.baseUrl ?? process.env.TREESEED_MARKET_API_BASE_URL ?? options.deployConfig?.hosting?.marketBaseUrl) ? 'self_http' : 'noop';
	}
	return 'noop';
}

class NoopControlPlaneReporter implements ControlPlaneReporter {
	readonly kind = 'noop' as const;
	readonly enabled = false;

	async reportEnvironment() {}
	async reportResource() {}
	async reportDeployment() {}
	async registerAgentPoolHeartbeat() {}
	async reportScaleDecision() {}
	async reportWorkdaySummary() {}
	async getProjectCapacityPlan() { return null; }
	async createCapacityReservation() { return null; }
	async reportCapacityEstimate() { return null; }
	async reportCapacityUsage() {}
	async reportCapacityRoutingDecision() { return null; }
	async createApprovalRequest() { return null; }
}

class HttpControlPlaneReporter implements ControlPlaneReporter {
	readonly enabled: boolean;

	constructor(
		readonly kind: 'market_http' | 'self_http',
		private readonly projectId: string | null,
		private readonly baseUrl: string | null,
		private readonly runnerToken: string | null,
		private readonly fetchImpl: typeof fetch = fetch,
	) {
		this.enabled = Boolean(this.projectId && this.baseUrl && this.runnerToken);
	}

	private async request<TPayload = unknown>(method: 'GET' | 'POST' | 'PUT', pathname: string, body?: Record<string, unknown>) {
		if (!this.enabled || !this.baseUrl || !this.runnerToken) {
			return null;
		}

		const response = await this.fetchImpl(new URL(pathname, this.baseUrl), {
			method,
			headers: {
				authorization: `Bearer ${this.runnerToken}`,
				'content-type': 'application/json',
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});

		if (!response.ok) {
			throw new Error(`Control-plane request failed for ${pathname}: ${response.status} ${response.statusText}`);
		}
		const envelope = await response.json().catch(() => null) as { ok?: boolean; payload?: TPayload } | null;
		return envelope?.payload ?? null;
	}

	async reportEnvironment(input: ControlPlaneEnvironmentReport) {
		if (!this.projectId) return;
		await this.request('PUT', `/v1/projects/${this.projectId}/runner/environments/${input.environment}`, input as Record<string, unknown>);
	}

	async reportResource(input: ControlPlaneResourceReport) {
		if (!this.projectId) return;
		await this.request('POST', `/v1/projects/${this.projectId}/runner/resources`, input as Record<string, unknown>);
	}

	async reportDeployment(input: ControlPlaneDeploymentReport) {
		if (!this.projectId) return;
		const normalizedStatus = input.status === 'success' ? 'succeeded' : input.status;
		await this.request('POST', `/v1/projects/${this.projectId}/runner/deployments`, {
			...input,
			status: normalizedStatus,
		});
	}

	async registerAgentPoolHeartbeat(input: ControlPlaneAgentPoolHeartbeat) {
		if (!this.projectId) return;
		await this.request(
			'POST',
			`/v1/projects/${this.projectId}/runner/agent-pools/${encodeURIComponent(input.poolName)}/register`,
			input as Record<string, unknown>,
		);
	}

	async reportScaleDecision(input: ControlPlaneScaleDecisionReport) {
		if (!this.projectId) return;
		await this.request(
			'POST',
			`/v1/projects/${this.projectId}/runner/agent-pools/${encodeURIComponent(input.poolName)}/scale-decisions`,
			input as Record<string, unknown>,
		);
	}

	async reportWorkdaySummary(input: ControlPlaneWorkdaySummaryReport) {
		if (!this.projectId) return;
		await this.request('POST', `/v1/projects/${this.projectId}/runner/workdays`, input as Record<string, unknown>);
	}

	async getProjectCapacityPlan(environment?: ProjectEnvironmentName | 'local' | null) {
		if (!this.projectId) return null;
		const suffix = environment ? `?environment=${encodeURIComponent(environment)}` : '';
		return this.request<CapacityPlan>('GET', `/v1/projects/${this.projectId}/capacity-plan${suffix}`);
	}

	async createCapacityReservation(input: CreateCapacityReservationRequest) {
		if (!this.projectId) return null;
		return this.request<CapacityReservation>('POST', `/v1/projects/${this.projectId}/runner/capacity/reservations`, input as Record<string, unknown>);
	}

	async reportCapacityEstimate(input: CreateTaskEstimateRequest) {
		if (!this.projectId) return null;
		return this.request<TaskEstimate>('POST', `/v1/projects/${this.projectId}/runner/capacity/estimates`, input as unknown as Record<string, unknown>);
	}

	async reportCapacityUsage(input: RecordCapacityUsageRequest) {
		if (!this.projectId) return;
		await this.request('POST', `/v1/projects/${this.projectId}/runner/capacity/usage`, input as Record<string, unknown>);
	}

	async reportCapacityRoutingDecision(input: CreateCapacityRoutingDecisionRequest) {
		if (!this.projectId) return null;
		return this.request<CapacityRoutingDecision>('POST', `/v1/projects/${this.projectId}/runner/capacity/routing-decisions`, input as Record<string, unknown>);
	}

	async createApprovalRequest(input: CreateApprovalRequestRequest) {
		if (!this.projectId) return null;
		return this.request<ApprovalRequest>('POST', `/v1/projects/${this.projectId}/runner/approval-requests`, input as Record<string, unknown>);
	}
}

export function createControlPlaneReporter(options: ResolveControlPlaneReporterOptions = {}): ControlPlaneReporter {
	const kind = resolveReporterKind(options);
	if (kind === 'noop') {
		return new NoopControlPlaneReporter();
	}

	const projectId = String(
		options.projectId
		?? process.env.TREESEED_PROJECT_ID
		?? options.deployConfig?.hosting?.projectId
		?? '',
	).trim() || null;
	const baseUrl = normalizeUrl(
		options.baseUrl
		?? process.env.TREESEED_MARKET_API_BASE_URL
		?? options.deployConfig?.hosting?.marketBaseUrl
		?? null,
	);
	const runnerToken = String(options.runnerToken ?? process.env.TREESEED_PROJECT_RUNNER_TOKEN ?? '').trim() || null;

	if (!projectId || !baseUrl || !runnerToken) {
		return new NoopControlPlaneReporter();
	}

	return new HttpControlPlaneReporter(kind, projectId, baseUrl, runnerToken, options.fetchImpl);
}
