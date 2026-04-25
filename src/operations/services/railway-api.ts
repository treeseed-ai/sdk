const DEFAULT_RAILWAY_API_URL = 'https://backboard.railway.com/graphql/v2';
const DEFAULT_RAILWAY_WORKSPACE = 'knowledge-coop';

export function normalizeRailwayEnvironmentName(value: string | null | undefined) {
	const normalized = typeof value === 'string' ? value.trim() : '';
	if (!normalized) {
		return '';
	}
	return normalized === 'prod' ? 'production' : normalized;
}

export type RailwayWorkspaceSummary = {
	id: string;
	name: string;
};

export type RailwayEnvironmentSummary = {
	id: string;
	name: string;
};

export type RailwayServiceSummary = {
	id: string;
	name: string;
};

export type RailwayProjectSummary = {
	id: string;
	name: string;
	workspaceId: string | null;
	environments: RailwayEnvironmentSummary[];
	services: RailwayServiceSummary[];
};

export type RailwayServiceInstanceSummary = {
	id: string | null;
	buildCommand: string | null;
	startCommand: string | null;
	rootDirectory: string | null;
	healthcheckPath: string | null;
	healthcheckTimeoutSeconds: number | null;
	healthcheckIntervalSeconds: number | null;
	restartPolicy: string | null;
	runtimeMode: string | null;
	sleepApplication: boolean | null;
	runtimeConfigSupported: boolean;
};

export type RailwayCustomDomainDnsRecord = {
	fqdn: string;
	hostlabel: string;
	recordType: string;
	requiredValue: string;
	currentValue: string;
	status: string;
	zone: string;
	purpose: string;
};

export type RailwayCustomDomainSummary = {
	id: string;
	domain: string;
	environmentId: string;
	serviceId: string;
	targetPort: number | null;
	verified: boolean;
	certificateStatus: string | null;
	verificationDnsHost: string | null;
	verificationToken: string | null;
	dnsRecords: RailwayCustomDomainDnsRecord[];
};

function configuredEnvValue(env: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined, name: string) {
	const value = env?.[name];
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function isUsableRailwayToken(value: string | undefined | null) {
	return typeof value === 'string' && value.trim().length >= 8;
}

export function resolveRailwayApiToken(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env) {
	const token = configuredEnvValue(env, 'RAILWAY_API_TOKEN');
	return isUsableRailwayToken(token) ? token : '';
}

export function resolveRailwayApiUrl(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env) {
	return configuredEnvValue(env, 'TREESEED_RAILWAY_API_URL') || DEFAULT_RAILWAY_API_URL;
}

export function resolveRailwayWorkspace(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env) {
	return configuredEnvValue(env, 'TREESEED_RAILWAY_WORKSPACE') || DEFAULT_RAILWAY_WORKSPACE;
}

function normalizeRailwayErrorMessage(payload: unknown, fallbackStatus?: number) {
	if (payload && typeof payload === 'object' && Array.isArray((payload as { errors?: unknown[] }).errors) && (payload as { errors: unknown[] }).errors.length > 0) {
		const first = (payload as { errors: unknown[] }).errors[0];
		if (first && typeof first === 'object' && typeof (first as { message?: unknown }).message === 'string') {
			return (first as { message: string }).message;
		}
	}
	return typeof fallbackStatus === 'number'
		? `Railway API request failed with ${fallbackStatus}.`
		: 'Railway API request failed.';
}

function isRetryableRailwayStatus(status: number) {
	return status === 408 || status === 429 || status >= 500;
}

function parseRetryAfterMs(value: string | null) {
	if (!value) {
		return null;
	}
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return Math.round(seconds * 1000);
	}
	const absoluteTime = Date.parse(value);
	if (Number.isFinite(absoluteTime)) {
		return Math.max(0, absoluteTime - Date.now());
	}
	return null;
}

function markRailwayTransientError(error: Error, options: { retryAfterMs?: number | null } = {}) {
	const tagged = error as Error & { treeseedTransient?: boolean; treeseedRetryAfterMs?: number };
	tagged.treeseedTransient = true;
	if (typeof options.retryAfterMs === 'number' && Number.isFinite(options.retryAfterMs) && options.retryAfterMs >= 0) {
		tagged.treeseedRetryAfterMs = options.retryAfterMs;
	}
	return tagged;
}

function isTransientRailwayRequestError(error: unknown) {
	if (error && typeof error === 'object' && (error as { treeseedTransient?: boolean }).treeseedTransient === true) {
		return true;
	}
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /fetch failed|timed out|etimedout|econnreset|enetunreach|temporarily unavailable|aborted|rate limit|too many requests|429/iu.test(message);
}

function railwayConnectionLabel(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeConnectionNodes<T>(connection: unknown, mapper: (node: Record<string, unknown>) => T | null) {
	if (!connection || typeof connection !== 'object' || !Array.isArray((connection as { edges?: unknown[] }).edges)) {
		return [];
	}
	return (connection as { edges: unknown[] }).edges
		.map((edge) => {
			if (!edge || typeof edge !== 'object') {
				return null;
			}
			const node = (edge as { node?: unknown }).node;
			return node && typeof node === 'object' ? mapper(node as Record<string, unknown>) : null;
		})
		.filter(Boolean) as T[];
}

function normalizeWorkspace(node: Record<string, unknown>): RailwayWorkspaceSummary | null {
	const id = railwayConnectionLabel(node.id);
	const name = railwayConnectionLabel(node.name);
	if (!id || !name) {
		return null;
	}
	return { id, name };
}

function normalizeEnvironment(node: Record<string, unknown>): RailwayEnvironmentSummary | null {
	const id = railwayConnectionLabel(node.id);
	const name = railwayConnectionLabel(node.name);
	if (!id || !name) {
		return null;
	}
	return { id, name };
}

function normalizeService(node: Record<string, unknown>): RailwayServiceSummary | null {
	const id = railwayConnectionLabel(node.id);
	const name = railwayConnectionLabel(node.name);
	if (!id || !name) {
		return null;
	}
	return { id, name };
}

function normalizeProject(node: Record<string, unknown>): RailwayProjectSummary | null {
	const id = railwayConnectionLabel(node.id);
	const name = railwayConnectionLabel(node.name);
	if (!id || !name) {
		return null;
	}
	return {
		id,
		name,
		workspaceId: railwayConnectionLabel(node.workspaceId) || null,
		environments: normalizeConnectionNodes(node.environments, normalizeEnvironment),
		services: normalizeConnectionNodes(node.services, normalizeService),
	};
}

function normalizeVariableMap(value: unknown): Record<string, string | null> {
	if (!value) {
		return {};
	}
	if (typeof value === 'string') {
		try {
			return normalizeVariableMap(JSON.parse(value));
		} catch {
			return {};
		}
	}
	if (typeof value !== 'object' || Array.isArray(value)) {
		return {};
	}
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
			if (typeof entryValue === 'string') {
				return [key, entryValue];
			}
			if (entryValue && typeof entryValue === 'object' && typeof (entryValue as { value?: unknown }).value === 'string') {
				return [key, (entryValue as { value: string }).value];
			}
			return [key, null];
		}),
	);
}

function normalizeRailwayNumber(value: unknown) {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function normalizeRailwayCustomDomainDnsRecord(node: Record<string, unknown>): RailwayCustomDomainDnsRecord | null {
	const fqdn = railwayConnectionLabel(node.fqdn);
	if (!fqdn) {
		return null;
	}
	return {
		fqdn,
		hostlabel: railwayConnectionLabel(node.hostlabel),
		recordType: railwayConnectionLabel(node.recordType),
		requiredValue: railwayConnectionLabel(node.requiredValue),
		currentValue: railwayConnectionLabel(node.currentValue),
		status: railwayConnectionLabel(node.status),
		zone: railwayConnectionLabel(node.zone),
		purpose: railwayConnectionLabel(node.purpose),
	};
}

function normalizeRailwayCustomDomain(node: Record<string, unknown>): RailwayCustomDomainSummary | null {
	const id = railwayConnectionLabel(node.id);
	const domain = railwayConnectionLabel(node.domain);
	if (!id || !domain) {
		return null;
	}
	const status = node.status && typeof node.status === 'object' ? node.status as Record<string, unknown> : {};
	const dnsRecords = Array.isArray(status.dnsRecords)
		? status.dnsRecords
			.map((entry) => entry && typeof entry === 'object' ? normalizeRailwayCustomDomainDnsRecord(entry as Record<string, unknown>) : null)
			.filter(Boolean) as RailwayCustomDomainDnsRecord[]
		: [];
	return {
		id,
		domain,
		environmentId: railwayConnectionLabel(node.environmentId),
		serviceId: railwayConnectionLabel(node.serviceId),
		targetPort: typeof node.targetPort === 'number' && Number.isFinite(node.targetPort) ? node.targetPort : null,
		verified: status.verified === true,
		certificateStatus: railwayConnectionLabel(status.certificateStatus) || null,
		verificationDnsHost: railwayConnectionLabel(status.verificationDnsHost) || null,
		verificationToken: railwayConnectionLabel(status.verificationToken) || null,
		dnsRecords,
	};
}

export async function railwayGraphqlRequest<TData = unknown>({
	query,
	variables,
	env = process.env,
	apiToken,
	apiUrl,
	fetchImpl = fetch,
	timeoutMs = 15_000,
	retries = 5,
}: {
	query: string;
	variables?: Record<string, unknown>;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	apiToken?: string;
	apiUrl?: string;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	retries?: number;
}): Promise<{ data: TData }> {
	const token = apiToken || resolveRailwayApiToken(env);
	if (!token) {
		throw new Error('Configure RAILWAY_API_TOKEN before invoking Railway APIs.');
	}
	let attempt = 0;
	for (;;) {
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | null = null;
		try {
			const response = await Promise.race([
				fetchImpl(apiUrl || resolveRailwayApiUrl(env), {
					method: 'POST',
					headers: {
						authorization: `Bearer ${token}`,
						'content-type': 'application/json',
					},
					body: JSON.stringify({ query, variables }),
					signal: controller.signal,
				}),
				new Promise<Response>((_, reject) => {
					timer = setTimeout(() => {
						controller.abort();
						reject(markRailwayTransientError(new Error(`Railway API request timed out after ${timeoutMs}ms.`)));
					}, timeoutMs);
				}),
			]);
			const payload = await response.json().catch(() => ({}));
			if (!response.ok || (Array.isArray((payload as { errors?: unknown[] }).errors) && (payload as { errors: unknown[] }).errors.length > 0)) {
				const message = normalizeRailwayErrorMessage(payload, response.status);
				const hasGraphqlErrors = Array.isArray((payload as { errors?: unknown[] }).errors) && (payload as { errors: unknown[] }).errors.length > 0;
				const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
				const shouldRetry = isRetryableRailwayStatus(response.status) || /rate limit|too many requests/iu.test(message);
				const error = new Error(message);
				if (shouldRetry || (hasGraphqlErrors && /rate limit|too many requests/iu.test(message))) {
					throw markRailwayTransientError(error, { retryAfterMs });
				}
				throw error;
			}
			return payload as { data: TData };
		} catch (error) {
			if (attempt >= retries || !isTransientRailwayRequestError(error)) {
				throw error;
			}
			attempt += 1;
			const retryAfterMs = error && typeof error === 'object' && typeof (error as { treeseedRetryAfterMs?: unknown }).treeseedRetryAfterMs === 'number'
				? Math.max(0, Number((error as { treeseedRetryAfterMs: number }).treeseedRetryAfterMs))
				: null;
			const backoffMs = retryAfterMs ?? Math.min(500 * (2 ** (attempt - 1)), 4000);
			await new Promise((resolve) => setTimeout(resolve, backoffMs));
		} finally {
			if (timer) {
				clearTimeout(timer);
			}
		}
	}
}

export async function getRailwayAuthProfile({
	env = process.env,
	fetchImpl = fetch,
}: {
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		me?: {
			id?: string;
			name?: string;
			email?: string;
			workspaces?: Array<{ id?: string; name?: string }> | null;
		} | null;
	}>({
		query: `
query TreeseedRailwayAuthProfile {
	me {
		id
		name
		email
		workspaces {
			id
			name
		}
	}
}
`.trim(),
		env,
		fetchImpl,
	});
	const me = payload.data?.me;
	return {
		id: railwayConnectionLabel(me?.id) || null,
		name: railwayConnectionLabel(me?.name) || null,
		email: railwayConnectionLabel(me?.email) || null,
		workspaces: Array.isArray(me?.workspaces)
			? me.workspaces
				.map((workspace) => workspace && typeof workspace === 'object' ? normalizeWorkspace(workspace as Record<string, unknown>) : null)
				.filter(Boolean) as RailwayWorkspaceSummary[]
			: [],
	};
}

export async function resolveRailwayWorkspaceContext({
	env = process.env,
	workspace,
	fetchImpl = fetch,
}: {
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	workspace?: string;
	fetchImpl?: typeof fetch;
}) {
	const desired = (workspace || resolveRailwayWorkspace(env)).trim();
	const profile = await getRailwayAuthProfile({ env, fetchImpl });
	const match = profile.workspaces.find((candidate) => candidate.id === desired || candidate.name === desired) ?? null;
	if (!match) {
		const available = profile.workspaces.map((candidate) => candidate.name).join(', ') || '(none)';
		throw new Error(`Railway workspace ${desired} is not visible to the current token. Available workspaces: ${available}.`);
	}
	return match;
}

export async function listRailwayProjects({
	env = process.env,
	workspaceId,
	fetchImpl = fetch,
}: {
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	workspaceId: string;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		projects?: { edges?: Array<{ node?: Record<string, unknown> | null } | null> } | null;
	}>({
		query: `
query TreeseedRailwayProjects($workspaceId: String!, $first: Int!) {
	projects(workspaceId: $workspaceId, first: $first) {
		edges {
			node {
				id
				name
				workspaceId
				environments(first: 50) {
					edges {
						node {
							id
							name
						}
					}
				}
				services(first: 50) {
					edges {
						node {
							id
							name
						}
					}
				}
			}
		}
	}
}
`.trim(),
		variables: { workspaceId, first: 100 },
		env,
		fetchImpl,
	});
	return normalizeConnectionNodes(payload.data?.projects, normalizeProject);
}

export async function getRailwayProject({
	projectId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		project?: Record<string, unknown> | null;
	}>({
		query: `
query TreeseedRailwayProject($projectId: String!) {
	project(id: $projectId) {
		id
		name
		workspaceId
		environments(first: 50) {
			edges {
				node {
					id
					name
				}
			}
		}
		services(first: 50) {
			edges {
				node {
					id
					name
				}
			}
		}
	}
}
`.trim(),
		variables: { projectId },
		env,
		fetchImpl,
	});
	return payload.data?.project ? normalizeProject(payload.data.project) : null;
}

export async function ensureRailwayProject({
	projectName,
	projectId,
	defaultEnvironmentName = 'staging',
	env = process.env,
	workspace,
	fetchImpl = fetch,
}: {
	projectName?: string | null;
	projectId?: string | null;
	defaultEnvironmentName?: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	workspace?: string;
	fetchImpl?: typeof fetch;
}) {
	const workspaceContext = await resolveRailwayWorkspaceContext({ env, workspace, fetchImpl });
	const projects = await listRailwayProjects({ env, workspaceId: workspaceContext.id, fetchImpl });
	const desiredProjectName = railwayConnectionLabel(projectName);
	const desiredProjectId = railwayConnectionLabel(projectId);
	const existing = projects.find((project) =>
		(desiredProjectId && project.id === desiredProjectId)
		|| (desiredProjectName && project.name === desiredProjectName),
	) ?? null;
	if (existing) {
		return { workspace: workspaceContext, project: existing, created: false };
	}
	if (!desiredProjectName) {
		throw new Error('Railway project creation requires a project name.');
	}
	const created = await railwayGraphqlRequest<{
		projectCreate?: Record<string, unknown> | null;
	}>({
		query: `
mutation TreeseedRailwayProjectCreate($input: ProjectCreateInput!) {
	projectCreate(input: $input) {
		id
		name
		workspaceId
		environments(first: 50) {
			edges {
				node {
					id
					name
				}
			}
		}
		services(first: 50) {
			edges {
				node {
					id
					name
				}
			}
		}
	}
}
`.trim(),
		variables: {
			input: {
				name: desiredProjectName,
				workspaceId: workspaceContext.id,
				defaultEnvironmentName,
			},
		},
		env,
		fetchImpl,
	});
	const project = created.data?.projectCreate ? normalizeProject(created.data.projectCreate) : null;
	if (!project) {
		throw new Error(`Railway project create did not return a usable project for ${desiredProjectName}.`);
	}
	return { workspace: workspaceContext, project, created: true };
}

export async function ensureRailwayEnvironment({
	projectId,
	environmentName,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	environmentName: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const environments = await listRailwayEnvironments({ projectId, env, fetchImpl });
	const existing = environments.find((environment) => environment.name === environmentName || environment.id === environmentName) ?? null;
	if (existing) {
		return { environment: existing, created: false };
	}
	const created = await railwayGraphqlRequest<{
		environmentCreate?: Record<string, unknown> | null;
	}>({
		query: `
mutation TreeseedRailwayEnvironmentCreate($input: EnvironmentCreateInput!) {
	environmentCreate(input: $input) {
		id
		name
	}
}
`.trim(),
		variables: {
			input: {
				projectId,
				name: environmentName,
				skipInitialDeploys: true,
			},
		},
		env,
		fetchImpl,
	});
	const environment = created.data?.environmentCreate ? normalizeEnvironment(created.data.environmentCreate) : null;
	if (!environment) {
		throw new Error(`Railway environment create did not return a usable environment for ${environmentName}.`);
	}
	return { environment, created: true };
}

export async function listRailwayEnvironments({
	projectId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		project?: Record<string, unknown> | null;
	}>({
		query: `
query TreeseedRailwayProjectEnvironments($projectId: String!) {
	project(id: $projectId) {
		id
		environments(first: 50) {
			edges {
				node {
					id
					name
				}
			}
		}
	}
}
`.trim(),
		variables: { projectId },
		env,
		fetchImpl,
	});
	return normalizeConnectionNodes(payload.data?.project ? (payload.data.project as Record<string, unknown>).environments : null, normalizeEnvironment);
}

export async function ensureRailwayService({
	projectId,
	serviceName,
	serviceId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	serviceName?: string | null;
	serviceId?: string | null;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const services = await listRailwayServices({ projectId, env, fetchImpl });
	const desiredServiceName = railwayConnectionLabel(serviceName);
	const desiredServiceId = railwayConnectionLabel(serviceId);
	const existing = services.find((service) =>
		(desiredServiceId && service.id === desiredServiceId)
		|| (desiredServiceName && service.name === desiredServiceName),
	) ?? null;
	if (existing) {
		return { service: existing, created: false };
	}
	if (!desiredServiceName) {
		throw new Error('Railway service creation requires a service name.');
	}
	const created = await railwayGraphqlRequest<{
		serviceCreate?: Record<string, unknown> | null;
	}>({
		query: `
mutation TreeseedRailwayServiceCreate($input: ServiceCreateInput!) {
	serviceCreate(input: $input) {
		id
		name
	}
}
`.trim(),
		variables: {
			input: {
				projectId,
				name: desiredServiceName,
			},
		},
		env,
		fetchImpl,
	});
	const service = created.data?.serviceCreate ? normalizeService(created.data.serviceCreate) : null;
	if (!service) {
		throw new Error(`Railway service create did not return a usable service for ${desiredServiceName}.`);
	}
	return { service, created: true };
}

export async function listRailwayServices({
	projectId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		project?: Record<string, unknown> | null;
	}>({
		query: `
query TreeseedRailwayProjectServices($projectId: String!) {
	project(id: $projectId) {
		id
		services(first: 50) {
			edges {
				node {
					id
					name
				}
			}
		}
	}
}
`.trim(),
		variables: { projectId },
		env,
		fetchImpl,
	});
	return normalizeConnectionNodes(payload.data?.project ? (payload.data.project as Record<string, unknown>).services : null, normalizeService);
}

export async function getRailwayServiceInstance({
	serviceId,
	environmentId,
	env = process.env,
	fetchImpl = fetch,
}: {
	serviceId: string;
	environmentId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const legacySummary = {
		id: null,
		buildCommand: null,
		startCommand: null,
		rootDirectory: null,
		healthcheckPath: null,
		healthcheckTimeoutSeconds: null,
		healthcheckIntervalSeconds: null,
		restartPolicy: null,
		runtimeMode: null,
		sleepApplication: null,
		runtimeConfigSupported: false,
	} satisfies RailwayServiceInstanceSummary;
	try {
		const payload = await railwayGraphqlRequest<{
			serviceInstance?: Record<string, unknown> | null;
		}>({
			query: `
query TreeseedRailwayServiceInstance($serviceId: String!, $environmentId: String!) {
	serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
		id
		buildCommand
		startCommand
		rootDirectory
		healthcheckPath
		healthcheckTimeout
		sleepApplication
	}
}
`.trim(),
			variables: { serviceId, environmentId },
			env,
			fetchImpl,
		});
		const instance = payload.data?.serviceInstance;
		return {
			id: railwayConnectionLabel(instance?.id) || null,
			buildCommand: railwayConnectionLabel(instance?.buildCommand) || null,
			startCommand: railwayConnectionLabel(instance?.startCommand) || null,
			rootDirectory: railwayConnectionLabel(instance?.rootDirectory) || null,
			healthcheckPath: railwayConnectionLabel(instance?.healthcheckPath) || null,
			healthcheckTimeoutSeconds: normalizeRailwayNumber(instance?.healthcheckTimeout),
			healthcheckIntervalSeconds: null,
			restartPolicy: null,
			runtimeMode: instance?.sleepApplication === true ? 'serverless' : 'replicated',
			sleepApplication: typeof instance?.sleepApplication === 'boolean' ? instance.sleepApplication : null,
			runtimeConfigSupported: true,
		} satisfies RailwayServiceInstanceSummary;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error ?? '');
		if (/Cannot query field .*healthcheckPath|Cannot query field .*healthcheckTimeout|Cannot query field .*sleepApplication/iu.test(message)) {
			const payload = await railwayGraphqlRequest<{
				serviceInstance?: Record<string, unknown> | null;
			}>({
				query: `
query TreeseedRailwayServiceInstanceLegacy($serviceId: String!, $environmentId: String!) {
	serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
		id
		buildCommand
		startCommand
		rootDirectory
	}
}
`.trim(),
				variables: { serviceId, environmentId },
				env,
				fetchImpl,
			});
			const instance = payload.data?.serviceInstance;
			return {
				...legacySummary,
				id: railwayConnectionLabel(instance?.id) || null,
				buildCommand: railwayConnectionLabel(instance?.buildCommand) || null,
				startCommand: railwayConnectionLabel(instance?.startCommand) || null,
				rootDirectory: railwayConnectionLabel(instance?.rootDirectory) || null,
			} satisfies RailwayServiceInstanceSummary;
		}
		if (!/ServiceInstance not found/iu.test(message)) {
			throw error;
		}
		return legacySummary;
	}
}

export async function ensureRailwayServiceInstanceConfiguration({
	serviceId,
	environmentId,
	buildCommand,
	startCommand,
	rootDirectory,
	healthcheckPath,
	healthcheckTimeoutSeconds,
	healthcheckIntervalSeconds,
	restartPolicy,
	runtimeMode,
	env = process.env,
	fetchImpl = fetch,
}: {
	serviceId: string;
	environmentId: string;
	buildCommand?: string | null;
	startCommand?: string | null;
	rootDirectory?: string | null;
	healthcheckPath?: string | null;
	healthcheckTimeoutSeconds?: number | null;
	healthcheckIntervalSeconds?: number | null;
	restartPolicy?: string | null;
	runtimeMode?: string | null;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const current = await getRailwayServiceInstance({ serviceId, environmentId, env, fetchImpl });
	if (!current.id) {
		return { instance: current, updated: false };
	}
	const desired = {
		buildCommand: railwayConnectionLabel(buildCommand) || null,
		startCommand: railwayConnectionLabel(startCommand) || null,
		rootDirectory: railwayConnectionLabel(rootDirectory) || null,
		healthcheckPath: railwayConnectionLabel(healthcheckPath) || null,
		healthcheckTimeoutSeconds: normalizeRailwayNumber(healthcheckTimeoutSeconds),
		healthcheckIntervalSeconds: normalizeRailwayNumber(healthcheckIntervalSeconds),
		restartPolicy: railwayConnectionLabel(restartPolicy) || null,
		runtimeMode: railwayConnectionLabel(runtimeMode) || null,
		sleepApplication: railwayConnectionLabel(runtimeMode) === 'serverless'
			? true
			: railwayConnectionLabel(runtimeMode) === 'replicated'
				? false
				: null,
	};
	const needsRuntimeConfig = desired.healthcheckPath !== null
		|| desired.healthcheckTimeoutSeconds !== null
		|| desired.runtimeMode !== null;
	if (needsRuntimeConfig && current.runtimeConfigSupported !== true) {
		throw new Error('Railway service instance runtime settings are unsupported by the current Railway API schema.');
	}
	if (desired.healthcheckIntervalSeconds !== null) {
		throw new Error('Railway service instance healthcheck intervals are unsupported by the current Railway API schema.');
	}
	if (desired.restartPolicy !== null) {
		throw new Error('Railway service instance restart policies are unsupported by the current Railway API schema.');
	}
	const drifted = (
		(desired.buildCommand !== null && desired.buildCommand !== current.buildCommand)
		|| (desired.startCommand !== null && desired.startCommand !== current.startCommand)
		|| (desired.rootDirectory !== null && desired.rootDirectory !== current.rootDirectory)
		|| (desired.healthcheckPath !== null && desired.healthcheckPath !== current.healthcheckPath)
		|| (desired.healthcheckTimeoutSeconds !== null && desired.healthcheckTimeoutSeconds !== current.healthcheckTimeoutSeconds)
		|| (desired.runtimeMode !== null && desired.runtimeMode !== current.runtimeMode)
	);
	if (!drifted) {
		return { instance: current, updated: false };
	}
	const mutationQuery = needsRuntimeConfig
		? `
mutation TreeseedRailwayServiceInstanceUpdate($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
	serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
}
`.trim()
		: `
mutation TreeseedRailwayServiceInstanceUpdateLegacy($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
	serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
}
`.trim();
	try {
		await railwayGraphqlRequest<{
			serviceInstanceUpdate?: boolean | null;
		}>({
			query: mutationQuery,
			variables: {
				serviceId,
				environmentId,
				input: {
					...(desired.buildCommand !== null ? { buildCommand: desired.buildCommand } : {}),
					...(desired.startCommand !== null ? { startCommand: desired.startCommand } : {}),
					...(desired.rootDirectory !== null ? { rootDirectory: desired.rootDirectory } : {}),
					...(desired.healthcheckPath !== null ? { healthcheckPath: desired.healthcheckPath } : {}),
					...(desired.healthcheckTimeoutSeconds !== null ? { healthcheckTimeout: desired.healthcheckTimeoutSeconds } : {}),
					...(desired.sleepApplication !== null ? { sleepApplication: desired.sleepApplication } : {}),
				},
			},
			env,
			fetchImpl,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error ?? '');
		if (needsRuntimeConfig && /Field .* is not defined by type .*ServiceInstanceUpdateInput|Unknown argument|Cannot query field/iu.test(message)) {
			throw new Error('Railway service instance runtime settings are unsupported by the current Railway API schema.');
		}
		throw error;
	}
	const instance = await getRailwayServiceInstance({
		serviceId,
		environmentId,
		env,
		fetchImpl,
	});
	return {
		instance: {
			id: instance.id || current.id,
			buildCommand: instance.buildCommand ?? desired.buildCommand,
			startCommand: instance.startCommand ?? desired.startCommand,
			rootDirectory: instance.rootDirectory ?? desired.rootDirectory,
			healthcheckPath: instance.healthcheckPath ?? desired.healthcheckPath,
			healthcheckTimeoutSeconds: instance.healthcheckTimeoutSeconds ?? desired.healthcheckTimeoutSeconds,
			healthcheckIntervalSeconds: instance.healthcheckIntervalSeconds ?? desired.healthcheckIntervalSeconds,
			restartPolicy: instance.restartPolicy ?? desired.restartPolicy,
			runtimeMode: instance.runtimeMode ?? desired.runtimeMode,
			sleepApplication: instance.sleepApplication ?? desired.sleepApplication,
			runtimeConfigSupported: instance.runtimeConfigSupported,
		} satisfies RailwayServiceInstanceSummary,
		updated: true,
	};
}

export async function listRailwayVariables({
	projectId,
	environmentId,
	serviceId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	environmentId: string;
	serviceId?: string | null;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		variables?: unknown;
	}>({
		query: `
query TreeseedRailwayVariables($projectId: String!, $environmentId: String!, $serviceId: String) {
	variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId, unrendered: true)
}
`.trim(),
		variables: {
			projectId,
			environmentId,
			serviceId: serviceId || null,
		},
		env,
		fetchImpl,
	});
	return normalizeVariableMap(payload.data?.variables);
}

export async function upsertRailwayVariables({
	projectId,
	environmentId,
	serviceId,
	variables,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	environmentId: string;
	serviceId?: string | null;
	variables: Record<string, string>;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	if (Object.keys(variables).length === 0) {
		return;
	}
	await railwayGraphqlRequest({
		query: `
mutation TreeseedRailwayVariableCollectionUpsert($input: VariableCollectionUpsertInput!) {
	variableCollectionUpsert(input: $input)
}
`.trim(),
		variables: {
			input: {
				projectId,
				environmentId,
				serviceId: serviceId || null,
				variables,
				replace: false,
				skipDeploys: true,
			},
		},
		env,
		fetchImpl,
	});
}

export async function listRailwayCustomDomains({
	projectId,
	environmentId,
	serviceId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	environmentId: string;
	serviceId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		domains?: {
			customDomains?: Array<Record<string, unknown> | null> | null;
		} | null;
	}>({
		query: `
query TreeseedRailwayCustomDomains($projectId: String!, $environmentId: String!, $serviceId: String!) {
	domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
		customDomains {
			id
			domain
			environmentId
			serviceId
			targetPort
			status {
				verified
				certificateStatus
				verificationDnsHost
				verificationToken
				dnsRecords {
					fqdn
					hostlabel
					recordType
					requiredValue
					currentValue
					status
					zone
					purpose
				}
			}
		}
	}
}
`.trim(),
		variables: {
			projectId,
			environmentId,
			serviceId,
		},
		env,
		fetchImpl,
	});
	return Array.isArray(payload.data?.domains?.customDomains)
		? payload.data.domains.customDomains
			.map((entry) => entry && typeof entry === 'object' ? normalizeRailwayCustomDomain(entry as Record<string, unknown>) : null)
			.filter(Boolean) as RailwayCustomDomainSummary[]
		: [];
}
