import type {
	ApprovalRequest,
	CreateApprovalRequestRequest,
	ProjectDeploymentKind,
	ProjectDeploymentStatus,
	ProjectEnvironmentName,
	ProjectInfrastructureResourceKind,
	ProjectInfrastructureResourceProvider,
	HostingKind,
	HostingRegistration,
} from '../models/sdk-types.ts';
import type { DeployConfig } from '../../platform/support/contracts.ts';

export type ControlPlaneReporterKind = 'noop' | 'market_http' | 'self_http';

export interface ControlPlaneEnvironmentReport {
	environment: ProjectEnvironmentName;
	deploymentProfile: HostingKind;
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

export interface ControlPlaneReporter {
	readonly kind: ControlPlaneReporterKind;
	readonly enabled: boolean;
	reportEnvironment(input: ControlPlaneEnvironmentReport): Promise<void>;
	reportResource(input: ControlPlaneResourceReport): Promise<void>;
	reportDeployment(input: ControlPlaneDeploymentReport): Promise<void>;
	createApprovalRequest(input: CreateApprovalRequestRequest): Promise<ApprovalRequest | null>;
}

export interface ControlPlaneReporterOptions {
	kind?: ControlPlaneReporterKind | null;
	projectId?: string | null;
	baseUrl?: string | null;
	runnerToken?: string | null;
	fetchImpl?: typeof fetch;
	requestTimeoutMs?: number | null;
}

export interface ResolveControlPlaneReporterOptions extends ControlPlaneReporterOptions {
	hostingKind?: HostingKind | null;
	registration?: HostingRegistration | null;
	deployConfig?: Pick<DeployConfig, 'hosting' | 'runtime'> | null;
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
		?? ((process.env.TREESEED_HOSTING_KIND?.trim() || null) as HostingKind | null)
		?? 'self_hosted_project';
	const registration = options.registration
		?? (options.deployConfig?.runtime?.registration === 'required' ? 'optional' : options.deployConfig?.runtime?.registration)
		?? options.deployConfig?.hosting?.registration
		?? ((process.env.TREESEED_HOSTING_REGISTRATION?.trim() || null) as HostingRegistration | null)
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
	if (hostingKind === 'treeseed_control_plane') {
		return normalizeUrl(options.baseUrl ?? process.env.TREESEED_API_BASE_URL ?? options.deployConfig?.hosting?.marketBaseUrl) ? 'self_http' : 'noop';
	}
	return 'noop';
}

class NoopControlPlaneReporter implements ControlPlaneReporter {
	readonly kind = 'noop' as const;
	readonly enabled = false;

	async reportEnvironment() {}
	async reportResource() {}
	async reportDeployment() {}
	async createApprovalRequest() { return null; }
}

class HttpControlPlaneReporter implements ControlPlaneReporter {
	readonly enabled: boolean;
	private readonly requestTimeoutMs: number;

	constructor(
		readonly kind: 'market_http' | 'self_http',
		private readonly projectId: string | null,
		private readonly baseUrl: string | null,
		private readonly runnerToken: string | null,
		private readonly fetchImpl: typeof fetch = fetch,
		requestTimeoutMs?: number | null,
	) {
		this.enabled = Boolean(this.projectId && this.baseUrl && this.runnerToken);
		this.requestTimeoutMs = normalizeRequestTimeoutMs(requestTimeoutMs);
	}

	private async request<TPayload = unknown>(method: 'GET' | 'POST' | 'PUT', pathname: string, body?: Record<string, unknown>) {
		if (!this.enabled || !this.baseUrl || !this.runnerToken) {
			return null;
		}
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

		let response: Response;
		try {
			response = await this.fetchImpl(new URL(pathname, this.baseUrl), {
				method,
				headers: {
					authorization: `Bearer ${this.runnerToken}`,
					'content-type': 'application/json',
				},
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: controller.signal,
			});
		} catch (error) {
			if (controller.signal.aborted) {
				throw new Error(`Control-plane request timed out for ${pathname} after ${this.requestTimeoutMs}ms.`);
			}
			throw error;
		} finally {
			clearTimeout(timeout);
		}

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

	async createApprovalRequest(input: CreateApprovalRequestRequest) {
		if (!this.projectId) return null;
		return this.request<ApprovalRequest>('POST', `/v1/projects/${this.projectId}/runner/approval-requests`, input as Record<string, unknown>);
	}
}

function normalizeRequestTimeoutMs(value: number | null | undefined) {
	if (Number.isFinite(value) && Number(value) > 0) {
		return Number(value);
	}
	const fromEnv = Number.parseInt(String(process.env.TREESEED_CONTROL_PLANE_REQUEST_TIMEOUT_MS ?? ''), 10);
	if (Number.isFinite(fromEnv) && fromEnv > 0) {
		return fromEnv;
	}
	return 15_000;
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
		?? process.env.TREESEED_API_BASE_URL
		?? options.deployConfig?.hosting?.marketBaseUrl
		?? null,
	);
	const runnerToken = String(options.runnerToken ?? process.env.TREESEED_PROJECT_RUNNER_TOKEN ?? '').trim() || null;

	if (!projectId || !baseUrl || !runnerToken) {
		return new NoopControlPlaneReporter();
	}

	return new HttpControlPlaneReporter(kind, projectId, baseUrl, runnerToken, options.fetchImpl, options.requestTimeoutMs);
}
