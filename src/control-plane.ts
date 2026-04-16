import type {
	AgentPoolAutoscalePolicy,
	ProjectDeploymentKind,
	ProjectDeploymentStatus,
	ProjectEnvironmentName,
	ProjectInfrastructureResourceKind,
	ProjectInfrastructureResourceProvider,
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
	deployConfig?: Pick<TreeseedDeployConfig, 'hosting'> | null;
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
		?? options.deployConfig?.hosting?.registration
		?? ((process.env.TREESEED_HOSTING_REGISTRATION?.trim() || null) as TreeseedHostingRegistration | null)
		?? 'none';

	if (hostingKind === 'hosted_project') {
		return 'market_http';
	}
	if (hostingKind === 'self_hosted_project' && registration === 'optional') {
		return 'market_http';
	}
	if (hostingKind === 'market_control_plane') {
		return normalizeUrl(options.baseUrl ?? options.deployConfig?.hosting?.marketBaseUrl) ? 'self_http' : 'noop';
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

	private async request(method: 'POST' | 'PUT', pathname: string, body: Record<string, unknown>) {
		if (!this.enabled || !this.baseUrl || !this.runnerToken) {
			return;
		}

		const response = await this.fetchImpl(new URL(pathname, this.baseUrl), {
			method,
			headers: {
				authorization: `Bearer ${this.runnerToken}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			throw new Error(`Control-plane request failed for ${pathname}: ${response.status} ${response.statusText}`);
		}
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
}

export function createControlPlaneReporter(options: ResolveControlPlaneReporterOptions = {}): ControlPlaneReporter {
	const kind = resolveReporterKind(options);
	if (kind === 'noop') {
		return new NoopControlPlaneReporter();
	}

	const projectId = String(
		options.projectId
		?? options.deployConfig?.hosting?.projectId
		?? process.env.TREESEED_PROJECT_ID
		?? '',
	).trim() || null;
	const baseUrl = normalizeUrl(
		options.baseUrl
		?? options.deployConfig?.hosting?.marketBaseUrl
		?? process.env.TREESEED_MARKET_API_BASE_URL
		?? null,
	);
	const runnerToken = String(options.runnerToken ?? process.env.TREESEED_PROJECT_RUNNER_TOKEN ?? '').trim() || null;

	if (!projectId || !baseUrl || !runnerToken) {
		return new NoopControlPlaneReporter();
	}

	return new HttpControlPlaneReporter(kind, projectId, baseUrl, runnerToken, options.fetchImpl);
}
