import {
	TREESEED_REMOTE_CONTRACT_HEADER,
	TREESEED_REMOTE_CONTRACT_VERSION,
} from './remote.ts';
import { parse as parseYaml } from 'yaml';
import {
	collectTreeseedConfigSeedValues,
	collectTreeseedEnvironmentContext,
	resolveTreeseedMachineEnvironmentValues,
	setTreeseedMachineEnvironmentValue,
} from './operations/services/config-runtime.ts';
import type { NativeUsageObservation } from './sdk-types.ts';
import type { ProjectRepositoryTopology } from './sdk-types.ts';
import type { SeedProjectArchitecture } from './seeds/types.ts';
import type {
	ProviderAssignmentLifecycleRequest,
	ProviderAssignmentLifecycleResult,
	ProviderCheckInRequest,
	ProviderNextAssignmentRequest,
} from './agent-capacity.ts';

export const CAPACITY_PROVIDER_ENDPOINTS = {
	register: '/v1/provider/register',
	heartbeat: '/v1/provider/heartbeat',
	checkIn: '/v1/provider/check-in',
	sessions: '/v1/provider/sessions',
	portfolio: '/v1/provider/portfolio',
	workdays: '/v1/provider/workdays',
	nextAssignment: '/v1/provider/assignments/next',
	assignment: (assignmentId: string) => `/v1/provider/assignments/${encodeURIComponent(assignmentId)}`,
	assignmentRenew: (assignmentId: string) => `/v1/provider/assignments/${encodeURIComponent(assignmentId)}/renew`,
	assignmentReturn: (assignmentId: string) => `/v1/provider/assignments/${encodeURIComponent(assignmentId)}/return`,
	assignmentComplete: (assignmentId: string) => `/v1/provider/assignments/${encodeURIComponent(assignmentId)}/complete`,
	assignmentFail: (assignmentId: string) => `/v1/provider/assignments/${encodeURIComponent(assignmentId)}/fail`,
	assignmentModeRuns: (assignmentId: string) => `/v1/provider/assignments/${encodeURIComponent(assignmentId)}/mode-runs`,
	assignmentWorkflowOperationDispatch: (assignmentId: string, operationId: string) => `/v1/provider/assignments/${encodeURIComponent(assignmentId)}/workflow-operations/${encodeURIComponent(operationId)}/dispatch`,
	assignmentExplanation: (assignmentId: string) => `/v1/provider/assignments/${encodeURIComponent(assignmentId)}/explanation`,
	usage: '/v1/provider/usage',
	reports: '/v1/provider/reports',
} as const;

export const CAPACITY_PROVIDER_SCOPES = [
	'provider:register',
	'provider:heartbeat',
	'provider:portfolio:read',
	'provider:assignments:read',
	'provider:assignments:write',
	'provider:usage:report',
	'provider:reports:write',
	'provider:capabilities:write',
] as const;

export const CAPACITY_PROVIDER_ENV_KEYS = [
	'TREESEED_MANAGEMENT_API_URL',
	'TREESEED_MARKET_URL',
	'TREESEED_MARKET_ID',
	'TREESEED_MANAGER_ID',
	'TREESEED_CAPACITY_PROVIDER_ID',
	'TREESEED_CAPACITY_PROVIDER_TEAM_ID',
	'TREESEED_CAPACITY_PROVIDER_API_KEY',
	'TREESEED_PROVIDER_HOST_DATA_DIR',
	'TREESEED_PROVIDER_DATA_DIR',
	'TREESEED_PROVIDER_API_PORT',
	'TREESEED_PROVIDER_HOST_API_PORT',
	'TREESEED_PROVIDER_ENVIRONMENT',
	'TREESEED_PROVIDER_CAPABILITIES_FILE',
	'TREESEED_PROVIDER_BUDGET_FILE',
	'TREESEED_PROVIDER_MAX_CONCURRENT_WORKDAYS',
	'TREESEED_PROVIDER_MAX_CONCURRENT_RUNNERS',
	'TREESEED_PROVIDER_DAILY_CREDIT_BUDGET',
	'TREESEED_PROVIDER_MONTHLY_CREDIT_BUDGET',
	'TREESEED_PROVIDER_STARTUP_MODE',
	'TREESEED_CODEX_AUTH_FILE',
	'TREESEED_CODEX_AUTH_JSON_B64',
	'TREESEED_CODEX_AUTH_OVERWRITE',
] as const;

export type CapacityProviderScope = (typeof CAPACITY_PROVIDER_SCOPES)[number];
export type CapacityProviderEnvironmentName = 'local' | 'staging' | 'prod' | 'production' | string;
export type CapacityProviderLaunchMode = 'self_hosted' | 'managed_market_host' | 'connected_host';
export type CapacityProviderStatus = 'pending' | 'online' | 'offline' | 'disabled' | 'rotation_required' | string;
export type CapacityProviderConnectionState = 'waiting_for_provider' | 'connected' | 'auth_failed' | 'stale' | 'disabled' | string;
export type CapacityProviderDeploymentStatus = 'not_deployed' | 'deploying' | 'deployed' | 'failed' | string;
export type CapacityProviderDeploymentServiceRole = 'api' | 'manager' | 'runner';

export const CAPACITY_PROVIDER_DEPLOYMENT_SERVICE_ROLES = ['api', 'manager', 'runner'] as const;

export const DEFAULT_CAPACITY_PROVIDER_ROLE_IMAGES = {
	api: 'treeseed/agent-api',
	manager: 'treeseed/agent-manager',
	runner: 'treeseed/agent-runner',
} as const satisfies Record<CapacityProviderDeploymentServiceRole, string>;

export interface CapacityProviderRuntimeInfo {
	package: '@treeseed/agent' | string;
	version: string;
	entrypoint: string;
	roles: string[];
}

export interface CapacityProviderCapability {
	id: string;
	agents: string[];
	operations: string[];
	models: string[];
	repositoryAccess: string;
	verification: string[];
	metadata?: Record<string, unknown>;
}

export type NativeCapacityUnit = 'wall_minute' | 'quota_minute' | 'usd' | 'token' | 'request' | 'gpu_second' | 'human_minute' | 'custom' | string;
export type NativeCapacityLimitScope = 'daily' | 'weekly' | 'monthly' | 'session' | 'rolling_window' | string;
export type NativeCapacityConfidence = 'exact' | 'estimated' | 'opaque' | string;
export type NativeCapacityLimitSource = 'configured' | 'observed' | 'learned' | 'manual_override' | string;
export type ProviderQuotaVisibility = 'exact' | 'partial' | 'opaque' | string;

export interface ExecutionProviderNativeLimitCapacity {
	id?: string;
	scope?: NativeCapacityLimitScope;
	limitScope?: NativeCapacityLimitScope;
	nativeUnit?: NativeCapacityUnit;
	limitAmount: number;
	reserveBufferPercent?: number | null;
	resetCadence?: string | null;
	resetAt?: string | null;
	confidence?: NativeCapacityConfidence;
	source?: NativeCapacityLimitSource;
	metadata?: Record<string, unknown>;
}

export interface ExecutionProviderObservationCapacity {
	id?: string;
	observedAt?: string;
	health?: string;
	activeWorkers?: number | null;
	queuedTasks?: number | null;
	throttleState?: string | null;
	nativeRemaining?: Record<string, unknown>;
	resetAt?: string | null;
	confidence?: NativeCapacityConfidence;
	metadata?: Record<string, unknown>;
}

export interface ExecutionProviderNativeCapacity {
	id?: string;
	name: string;
	kind: string;
	status?: string;
	nativeUnit: NativeCapacityUnit;
	quotaVisibility?: ProviderQuotaVisibility;
	maxConcurrentWorkers?: number | null;
	resetCadence?: string | null;
	config?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	nativeLimits?: ExecutionProviderNativeLimitCapacity[];
	observation?: ExecutionProviderObservationCapacity;
}

export interface CapacityProviderNativeCapacity {
	executionProviders: ExecutionProviderNativeCapacity[];
}

export interface CapacityProviderBudgetCapacity {
	dailyCreditBudget?: number | null;
	monthlyCreditBudget?: number | null;
	maxConcurrentWorkdays?: number | null;
	maxConcurrentRunners?: number | null;
	nativeCapacity?: CapacityProviderNativeCapacity;
	[key: string]: unknown;
}

export interface CapacityProviderHealthState {
	dataDirWritable?: boolean;
	codexReady?: boolean;
	[key: string]: unknown;
}

export interface CapacityProviderRegistrationRequest {
	marketId?: string;
	runtime: CapacityProviderRuntimeInfo;
	capabilities: CapacityProviderCapability[];
	budgets: CapacityProviderBudgetCapacity;
	health: CapacityProviderHealthState;
}

export interface CapacityProviderRegistrationResponse {
	ok: true;
	provider: {
		id: string;
		teamId: string;
		name: string;
		status: CapacityProviderStatus;
		connectionState?: CapacityProviderConnectionState;
	};
	portfolioManifestUrl: string;
	heartbeatIntervalSeconds: number;
	sessionToken?: string | null;
	sessionExpiresAt?: string | null;
}

export interface CapacityProviderHeartbeatRequest {
	marketId?: string;
	providerId?: string | null;
	runtime?: CapacityProviderRuntimeInfo;
	capabilities?: CapacityProviderCapability[];
	budgets?: CapacityProviderBudgetCapacity;
	health?: CapacityProviderHealthState;
	status?: CapacityProviderStatus;
	connectionState?: CapacityProviderConnectionState;
}

export interface CapacityProviderHeartbeatResponse {
	ok: true;
	provider?: CapacityProviderRegistrationResponse['provider'];
	heartbeatIntervalSeconds?: number;
}

export interface CapacityProviderPortfolioManifest {
	team: {
		id: string;
		slug: string;
		name: string;
	};
	projects: CapacityProviderPortfolioProject[];
}

export interface CapacityProviderPortfolioProject {
	id: string;
	slug: string;
	name: string;
	repository: {
		provider: string;
		role?: string | null;
		owner: string;
		name: string;
		defaultBranch: string;
		cloneUrl: string;
		currentBranch?: string | null;
		checkoutPath?: string | null;
		submodulePath?: string | null;
		webUrl?: string | null;
	};
	repositoryTopology?: ProjectRepositoryTopology;
	architecture?: SeedProjectArchitecture;
	agentSpecs: {
		root: string;
		testsRoot: string;
	};
	workPolicy: {
		enabled: boolean;
		startCron?: string | null;
		durationMinutes?: number | null;
		dailyCreditBudget?: number | null;
		maxRunners?: number | null;
		maxWorkersPerRunner?: number | null;
		[key: string]: unknown;
	};
	metadata?: Record<string, unknown>;
}

export interface ProviderWorkdayRequest {
	projectId: string;
	environment: CapacityProviderEnvironmentName;
	idempotencyKey?: string | null;
	kind?: string;
	summary?: Record<string, unknown> | null;
	metadata?: Record<string, unknown> | null;
}

export interface ProviderWorkdayResponse {
	ok: true;
	workDay: Record<string, unknown>;
}

export interface ProviderUsageReport {
	taskId?: string | null;
	workDayId?: string | null;
	projectId?: string | null;
	taskSignature?: string | null;
	executionProfileId?: string | null;
	executionProviderId?: string | null;
	modelName?: string | null;
	inputTokens?: number | null;
	outputTokens?: number | null;
	cachedInputTokens?: number | null;
	quotaMinutes?: number | null;
	wallMinutes?: number | null;
	filesOpened?: number | null;
	filesChanged?: number | null;
	diffLinesAdded?: number | null;
	diffLinesRemoved?: number | null;
	testRuns?: number | null;
	retryCount?: number | null;
	actualCredits?: number | null;
	actualCreditsOverride?: boolean | null;
	actualUsd?: number | null;
	nativeUsage?: NativeUsageObservation | Record<string, unknown> | null;
	metadata?: Record<string, unknown> | null;
}

export interface ProviderUsageReportResponse {
	ok: true;
	usage?: Record<string, unknown>;
}

export interface ProviderReportRequest {
	workDayId: string;
	kind: string;
	body: Record<string, unknown>;
	renderedRef?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface ProviderReportResponse {
	ok: true;
	report: Record<string, unknown>;
}

export interface CapacityProviderDeploymentIntent {
	teamId: string;
	capacityProviderId: string;
	launchMode: CapacityProviderLaunchMode;
	hostKind: string;
	hostId?: string | null;
	imageRef?: string | null;
	serviceRefs?: Record<string, unknown>;
	envRefs?: Record<string, unknown>;
}

export interface CapacityProviderDeploymentResult {
	id: string;
	teamId: string;
	capacityProviderId: string;
	launchMode: CapacityProviderLaunchMode;
	hostKind: string;
	hostId?: string | null;
	status: CapacityProviderDeploymentStatus;
	imageRef?: string | null;
	serviceRefs: Record<string, unknown>;
	envRefs: Record<string, unknown>;
	result: Record<string, unknown>;
	error?: Record<string, unknown> | null;
	createdAt?: string;
	updatedAt?: string;
	completedAt?: string | null;
}

export interface CapacityProviderDeploymentServiceSpec {
	role: CapacityProviderDeploymentServiceRole;
	serviceName: string;
	imageRef: string;
	startCommand: string;
	env: Record<string, string>;
	redactedEnv: Record<string, string>;
}

export interface CapacityProviderDeploymentServiceResult {
	role: CapacityProviderDeploymentServiceRole;
	serviceName: string;
	serviceId?: string | null;
	url?: string | null;
	status?: CapacityProviderDeploymentStatus;
	envRefs?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export interface CapacityProviderDeploymentAdapter {
	provisionService(spec: CapacityProviderDeploymentServiceSpec): Promise<CapacityProviderDeploymentServiceResult> | CapacityProviderDeploymentServiceResult;
}

export interface CapacityProviderDeploymentPrimitiveInput {
	intent: CapacityProviderDeploymentIntent;
	env: Record<string, string>;
	redactedEnv?: Record<string, string>;
	imageRef?: string | null;
	roleImageRefs?: Partial<Record<CapacityProviderDeploymentServiceRole, string>>;
	serviceNamePrefix?: string | null;
	adapter?: CapacityProviderDeploymentAdapter;
	now?: Date;
}

export interface CapacityProviderDeploymentPrimitiveResult {
	ok: boolean;
	launchMode: CapacityProviderLaunchMode;
	hostKind: string;
	imageRef: string;
	status: CapacityProviderDeploymentStatus;
	serviceRefs: Record<CapacityProviderDeploymentServiceRole, CapacityProviderDeploymentServiceResult>;
	envRefs: Record<string, unknown>;
	diagnostics: string[];
	deployedAt?: string | null;
	error?: Record<string, unknown> | null;
}

export interface CapacityProviderEnvironmentInput {
	marketUrl: string;
	marketId: string;
	apiKey: string;
	providerId?: string;
	teamId?: string;
	providerDataDir?: string;
	providerApiPort?: number | string;
	providerEnvironment?: CapacityProviderEnvironmentName;
	providerHostDataDir?: string;
	capabilitiesFile?: string;
	budgetFile?: string;
	maxConcurrentWorkdays?: number | string;
	maxConcurrentRunners?: number | string;
	dailyCreditBudget?: number | string;
	monthlyCreditBudget?: number | string;
	codexAuthFile?: string;
	codexAuthJsonB64?: string;
	codexAuthOverwrite?: boolean | number | string;
}

export interface CapacityProviderRoleImageConfig {
	image?: string;
	tag?: string;
}

export interface CapacityProviderImageExtensionConfig {
	enabled?: boolean;
	baseImage?: string;
	dockerfile?: string;
	context?: string;
	image?: string;
	tag?: string;
	buildArgs?: Record<string, string | number | boolean | null | undefined>;
}

export interface CapacityProviderLaunchManifest {
	schemaVersion: 1;
	provider?: {
		id?: string;
		environment?: string;
		dataDir?: string;
		market?: {
			profile?: string;
			url?: string;
			id?: string;
		};
	};
	runtime?: {
		images?: {
			tag?: string;
			architecture?: 'auto' | 'amd64' | 'arm64' | string;
			pullPolicy?: string;
			roles?: Partial<Record<CapacityProviderDeploymentServiceRole, CapacityProviderRoleImageConfig>>;
		};
		api?: {
			port?: number | string;
			hostPort?: number | string;
		};
		manager?: {
			pollSeconds?: number | string;
		};
		runners?: {
			count?: number | string;
			maxConcurrent?: number | string;
			dataDir?: string;
		};
	};
	extensions?: Partial<Record<CapacityProviderDeploymentServiceRole, CapacityProviderImageExtensionConfig>>;
	executionProviders?: unknown[];
	capabilities?: unknown[];
}

export interface CapacityProviderLaunchPlan {
	manifest: CapacityProviderLaunchManifest;
	roleImages: Record<CapacityProviderDeploymentServiceRole, string>;
	composeEnv: Record<string, string>;
	redactedEnv: Record<string, string>;
}

export interface CapacityProviderSelfHostInstructions {
	composeFile: string;
	commands: string[];
	env: Record<string, string>;
	redactedEnv: Record<string, string>;
	summary: string;
}

export interface CapacityProviderLaunchEnvironmentInput {
	tenantRoot?: string | null;
	scope?: 'local' | 'staging' | 'prod' | string;
	env?: NodeJS.ProcessEnv;
	overrides?: Record<string, string | number | boolean | null | undefined>;
	requireConnection?: boolean;
	diagnostic?: boolean;
}

export interface CapacityProviderLaunchEnvironment {
	env: Record<string, string>;
	redactedEnv: Record<string, string>;
	missing: string[];
	diagnostic: boolean;
	source: 'treeseed-config' | 'process-env';
}

export interface CapacityProviderConnectionConfigInput extends CapacityProviderEnvironmentInput {
	tenantRoot: string;
	scope?: 'local' | 'staging' | 'prod' | string;
	providerHostDataDir?: string;
	providerEnvironment?: CapacityProviderEnvironmentName;
}

export interface CapacityProviderConnectionConfigResult {
	env: Record<string, string>;
	redactedEnv: Record<string, string>;
	scope: string;
	writtenKeys: string[];
}

export interface MarketProviderClientOptions extends CapacityProviderEnvironmentInput {
	fetchImpl?: typeof fetch;
	userAgent?: string;
}

export class CapacityProviderApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly payload: unknown,
	) {
		super(message);
		this.name = 'CapacityProviderApiError';
	}
}

function normalizeBaseUrl(value: string) {
	const trimmed = value.trim().replace(/\/+$/u, '');
	if (!trimmed) throw new Error('Capacity provider Market URL is required.');
	return trimmed;
}

function stringValue(value: unknown, fallback?: string) {
	if (typeof value === 'string' && value.length > 0) return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return fallback ?? '';
}

function objectStringValues(value: Record<string, string | number | boolean | null | undefined> = {}) {
	return Object.fromEntries(
		Object.entries(value)
			.filter(([, entryValue]) => entryValue !== undefined && entryValue !== null && String(entryValue).length > 0)
			.map(([key, entryValue]) => [key, String(entryValue)]),
	);
}

function filterCapacityProviderEnv(value: Record<string, string | undefined>) {
	const allowed = new Set<string>(CAPACITY_PROVIDER_ENV_KEYS);
	return Object.fromEntries(
		Object.entries(value)
			.filter(([key, entryValue]) => allowed.has(key) && typeof entryValue === 'string' && entryValue.length > 0),
	) as Record<string, string>;
}

function capacityProviderConfigEntry(id: string) {
	return {
		id,
		label: id,
		group: 'capacity-provider',
		description: 'Capacity provider launch value.',
		howToGet: 'Created by local seed or stored through trsd config.',
		sensitivity: id === 'TREESEED_CAPACITY_PROVIDER_API_KEY' ? 'secret' : 'plain',
		targets: ['local-runtime'],
		scopes: ['local', 'staging', 'prod'],
		storage: 'scoped',
		requirement: 'optional',
		purposes: ['dev', 'deploy', 'config'],
	} as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string, label: string) {
	const value = record[key];
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`${label} is missing required string field "${key}".`);
	}
	return value;
}

function requireNumber(record: Record<string, unknown>, key: string, label: string) {
	const value = record[key];
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`${label} is missing required numeric field "${key}".`);
	}
	return value;
}

export function buildCapacityProviderAuthHeaders(apiKey: string) {
	const trimmed = apiKey.trim();
	if (!trimmed) throw new Error('Capacity provider API key is required.');
	return {
		authorization: `Bearer ${trimmed}`,
	};
}

export function assertCapacityProviderOkEnvelope(value: unknown, label = 'Capacity provider response'): asserts value is { ok: true } {
	if (!isRecord(value) || value.ok !== true) {
		throw new Error(`${label} must be an ok response envelope.`);
	}
}

export function assertCapacityProviderRegistrationResponse(value: unknown): asserts value is CapacityProviderRegistrationResponse {
	assertCapacityProviderOkEnvelope(value, 'Capacity provider registration response');
	const record = value as Record<string, unknown>;
	if (!isRecord(record.provider)) {
		throw new Error('Capacity provider registration response is missing provider.');
	}
	requireString(record.provider, 'id', 'Capacity provider registration provider');
	requireString(record.provider, 'teamId', 'Capacity provider registration provider');
	requireString(record.provider, 'name', 'Capacity provider registration provider');
	requireString(record.provider, 'status', 'Capacity provider registration provider');
	requireString(record, 'portfolioManifestUrl', 'Capacity provider registration response');
	requireNumber(record, 'heartbeatIntervalSeconds', 'Capacity provider registration response');
}

export function assertCapacityProviderPortfolioManifest(value: unknown): asserts value is CapacityProviderPortfolioManifest {
	if (!isRecord(value)) {
		throw new Error('Capacity provider portfolio manifest must be an object.');
	}
	if (!isRecord(value.team)) {
		throw new Error('Capacity provider portfolio manifest is missing team.');
	}
	requireString(value.team, 'id', 'Capacity provider portfolio team');
	requireString(value.team, 'slug', 'Capacity provider portfolio team');
	requireString(value.team, 'name', 'Capacity provider portfolio team');
	if (!Array.isArray(value.projects)) {
		throw new Error('Capacity provider portfolio manifest is missing projects.');
	}
	for (const [index, project] of value.projects.entries()) {
		if (!isRecord(project)) throw new Error(`Capacity provider portfolio project ${index} must be an object.`);
		requireString(project, 'id', `Capacity provider portfolio project ${index}`);
		requireString(project, 'slug', `Capacity provider portfolio project ${index}`);
		requireString(project, 'name', `Capacity provider portfolio project ${index}`);
		if (!isRecord(project.repository)) throw new Error(`Capacity provider portfolio project ${index} is missing repository.`);
		if (project.repositoryTopology !== undefined) {
			if (!isRecord(project.repositoryTopology)) {
				throw new Error(`Capacity provider portfolio project ${index} repositoryTopology must be an object.`);
			}
			if (!isRecord(project.repositoryTopology.contentRepository)) {
				throw new Error(`Capacity provider portfolio project ${index} repositoryTopology is missing contentRepository.`);
			}
			if (project.repositoryTopology.contentRepository.accessMode !== 'treedx') {
				throw new Error(`Capacity provider portfolio project ${index} contentRepository must use treedx access.`);
			}
			if (!isRecord(project.repositoryTopology.siteRepository)) {
				throw new Error(`Capacity provider portfolio project ${index} repositoryTopology is missing siteRepository.`);
			}
			if (project.repositoryTopology.siteRepository.accessMode !== 'filesystem') {
				throw new Error(`Capacity provider portfolio project ${index} siteRepository must use filesystem access.`);
			}
			if (
				project.repositoryTopology.projectRepository !== undefined
				&& project.repositoryTopology.projectRepository !== null
				&& (!isRecord(project.repositoryTopology.projectRepository) || project.repositoryTopology.projectRepository.accessMode !== 'filesystem')
			) {
				throw new Error(`Capacity provider portfolio project ${index} projectRepository must use filesystem access.`);
			}
		}
		if (!isRecord(project.agentSpecs)) throw new Error(`Capacity provider portfolio project ${index} is missing agentSpecs.`);
		if (!isRecord(project.workPolicy)) throw new Error(`Capacity provider portfolio project ${index} is missing workPolicy.`);
	}
}

export function resolveCapacityProviderEnvironment(input: CapacityProviderEnvironmentInput): Record<string, string> {
	const env: Record<string, string> = {
		TREESEED_MARKET_URL: normalizeBaseUrl(input.marketUrl),
		TREESEED_MARKET_ID: input.marketId.trim(),
		TREESEED_MANAGER_ID: input.marketId.trim(),
		TREESEED_CAPACITY_PROVIDER_API_KEY: input.apiKey.trim(),
		TREESEED_PROVIDER_DATA_DIR: input.providerDataDir ?? '/data',
		TREESEED_PROVIDER_API_PORT: stringValue(input.providerApiPort, '3100'),
		TREESEED_PROVIDER_ENVIRONMENT: input.providerEnvironment ?? 'local',
	};
	env.TREESEED_MANAGEMENT_API_URL = env.TREESEED_MARKET_URL || 'https://api.treeseed.ai';
	if (!env.TREESEED_CAPACITY_PROVIDER_API_KEY) throw new Error('Capacity provider API key is required.');
	if (input.providerId) env.TREESEED_CAPACITY_PROVIDER_ID = input.providerId;
	if (input.teamId) env.TREESEED_CAPACITY_PROVIDER_TEAM_ID = input.teamId;
	if (input.providerHostDataDir) env.TREESEED_PROVIDER_HOST_DATA_DIR = input.providerHostDataDir;
	if (input.capabilitiesFile) env.TREESEED_PROVIDER_CAPABILITIES_FILE = input.capabilitiesFile;
	if (input.budgetFile) env.TREESEED_PROVIDER_BUDGET_FILE = input.budgetFile;
	if (input.maxConcurrentWorkdays !== undefined) env.TREESEED_PROVIDER_MAX_CONCURRENT_WORKDAYS = stringValue(input.maxConcurrentWorkdays);
	if (input.maxConcurrentRunners !== undefined) env.TREESEED_PROVIDER_MAX_CONCURRENT_RUNNERS = stringValue(input.maxConcurrentRunners);
	if (input.dailyCreditBudget !== undefined) env.TREESEED_PROVIDER_DAILY_CREDIT_BUDGET = stringValue(input.dailyCreditBudget);
	if (input.monthlyCreditBudget !== undefined) env.TREESEED_PROVIDER_MONTHLY_CREDIT_BUDGET = stringValue(input.monthlyCreditBudget);
	if (input.codexAuthFile) env.TREESEED_CODEX_AUTH_FILE = input.codexAuthFile;
	if (input.codexAuthJsonB64) env.TREESEED_CODEX_AUTH_JSON_B64 = input.codexAuthJsonB64;
	if (input.codexAuthOverwrite !== undefined) env.TREESEED_CODEX_AUTH_OVERWRITE = stringValue(input.codexAuthOverwrite);
	return env;
}

export function resolveCapacityProviderLaunchEnvironment(input: CapacityProviderLaunchEnvironmentInput = {}): CapacityProviderLaunchEnvironment {
	const scope = input.scope === 'staging' || input.scope === 'prod' ? input.scope : 'local';
	const env = input.env ?? process.env;
	const overrides = objectStringValues(input.overrides);
	let configValues: Record<string, string> = {};
	let machineValues: Record<string, string> = {};
	let source: CapacityProviderLaunchEnvironment['source'] = 'process-env';
	if (input.tenantRoot) {
		try {
			configValues = collectTreeseedConfigSeedValues(input.tenantRoot, scope as never, env);
			source = 'treeseed-config';
		} catch {
			configValues = {};
		}
		try {
			machineValues = resolveTreeseedMachineEnvironmentValues(input.tenantRoot, scope as never, CAPACITY_PROVIDER_ENV_KEYS);
			source = 'treeseed-config';
		} catch {
			machineValues = {};
		}
	}
	const values = {
		...filterCapacityProviderEnv(configValues),
		...filterCapacityProviderEnv(machineValues),
		...filterCapacityProviderEnv(env),
		...filterCapacityProviderEnv(overrides),
	};
	const diagnostic = input.diagnostic === true || values.TREESEED_PROVIDER_STARTUP_MODE === 'diagnostic';
	const resolved = {
		TREESEED_PROVIDER_DATA_DIR: '/data',
		TREESEED_PROVIDER_API_PORT: '3100',
		TREESEED_PROVIDER_ENVIRONMENT: scope,
		...values,
	};
	if (!resolved.TREESEED_MARKET_ID && resolved.TREESEED_MANAGER_ID) {
		resolved.TREESEED_MARKET_ID = resolved.TREESEED_MANAGER_ID;
	}
	if (!resolved.TREESEED_MANAGER_ID && resolved.TREESEED_MARKET_ID) {
		resolved.TREESEED_MANAGER_ID = resolved.TREESEED_MARKET_ID;
	}
	if (!resolved.TREESEED_PROVIDER_HOST_API_PORT) {
		resolved.TREESEED_PROVIDER_HOST_API_PORT = resolved.TREESEED_PROVIDER_API_PORT;
	}
	if (!resolved.TREESEED_PROVIDER_HOST_DATA_DIR) {
		resolved.TREESEED_PROVIDER_HOST_DATA_DIR = '.treeseed/local-capacity-provider/data';
	}
	if (diagnostic) {
		resolved.TREESEED_PROVIDER_STARTUP_MODE = 'diagnostic';
	}
	const required = [
		...(diagnostic ? [] : ['TREESEED_CAPACITY_PROVIDER_API_KEY']),
		'TREESEED_PROVIDER_HOST_DATA_DIR',
	];
	const missing = required.filter((key) => !resolved[key]);
	if (input.requireConnection !== false && missing.length > 0) {
		throw new Error(`Capacity provider launch environment is missing: ${missing.join(', ')}.`);
	}
	return {
		env: resolved,
		redactedEnv: redactCapacityProviderEnv(resolved),
		missing,
		diagnostic,
		source,
	};
}

export function persistCapacityProviderConnectionToTreeseedConfig(input: CapacityProviderConnectionConfigInput): CapacityProviderConnectionConfigResult {
	const scope = input.scope === 'staging' || input.scope === 'prod' ? input.scope : 'local';
	const env = resolveCapacityProviderEnvironment({
		...input,
		providerEnvironment: input.providerEnvironment ?? 'local',
		providerHostDataDir: input.providerHostDataDir ?? '.treeseed/local-capacity-provider/data',
	});
	let registryEntries: Array<{ id: string }> = [];
	try {
		registryEntries = collectTreeseedEnvironmentContext(input.tenantRoot).entries;
	} catch {
		registryEntries = [];
	}
	const entryById = new Map(registryEntries.map((entry) => [entry.id, entry]));
	const keys = [
		'TREESEED_MANAGEMENT_API_URL',
		'TREESEED_MARKET_URL',
		'TREESEED_MARKET_ID',
		'TREESEED_MANAGER_ID',
		'TREESEED_CAPACITY_PROVIDER_ID',
		'TREESEED_CAPACITY_PROVIDER_TEAM_ID',
		'TREESEED_CAPACITY_PROVIDER_API_KEY',
		'TREESEED_PROVIDER_HOST_DATA_DIR',
		'TREESEED_PROVIDER_ENVIRONMENT',
	];
	for (const key of keys) {
		const entry = entryById.get(key) ?? capacityProviderConfigEntry(key);
		setTreeseedMachineEnvironmentValue(input.tenantRoot, scope, entry, env[key] ?? '');
	}
	return {
		env,
		redactedEnv: redactCapacityProviderEnv(env),
		scope,
		writtenKeys: keys,
	};
}

export function redactCapacityProviderSecret(value: string) {
	if (value.length <= 8) return '<redacted>';
	return `${value.slice(0, 4)}...<redacted>`;
}

export function isCapacityProviderSecretEnvKey(key: string) {
	return /(?:API_KEY|AUTH|TOKEN|SECRET|PASSWORD|CREDENTIAL)/u.test(key);
}

export function redactCapacityProviderEnv(env: Record<string, string>) {
	const redacted: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		redacted[key] = isCapacityProviderSecretEnvKey(key) ? redactCapacityProviderSecret(value) : value;
	}
	return redacted;
}

function manifestRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function manifestRoleImage(role: CapacityProviderDeploymentServiceRole, manifest: CapacityProviderLaunchManifest) {
	const tag = manifest.runtime?.images?.tag ?? 'latest';
	const roleConfig = manifest.runtime?.images?.roles?.[role] ?? {};
	const extension = manifest.extensions?.[role];
	if (extension?.enabled && extension.image) {
		return `${extension.image}:${extension.tag ?? tag}`;
	}
	return `${roleConfig.image ?? DEFAULT_CAPACITY_PROVIDER_ROLE_IMAGES[role]}:${roleConfig.tag ?? tag}`;
}

function assertSafeCapacityProviderManifest(value: CapacityProviderLaunchManifest) {
	for (const [role, extension] of Object.entries(value.extensions ?? {})) {
		if (!extension) continue;
		for (const [key, entryValue] of Object.entries(extension.buildArgs ?? {})) {
			if (entryValue === undefined || entryValue === null || entryValue === '') continue;
			if (isCapacityProviderSecretEnvKey(key) || /(?:tscp_|tsp_|sk-|ghp_|gho_|github_pat_)/u.test(String(entryValue))) {
				throw new Error(`Capacity provider ${role} extension build arg ${key} looks secret-like. Store secrets in Treeseed config or the host secret manager instead.`);
			}
		}
	}
}

export function parseCapacityProviderLaunchManifest(source: string | Record<string, unknown>): CapacityProviderLaunchManifest {
	const parsed = typeof source === 'string'
		? parseYaml(source) as unknown
		: source;
	const record = manifestRecord(parsed);
	if (record.schemaVersion !== 1) {
		throw new Error('Capacity provider launch manifest schemaVersion must be 1.');
	}
	const manifest = record as unknown as CapacityProviderLaunchManifest;
	assertSafeCapacityProviderManifest(manifest);
	return manifest;
}

export function resolveCapacityProviderLaunchPlan(manifest: CapacityProviderLaunchManifest): CapacityProviderLaunchPlan {
	assertSafeCapacityProviderManifest(manifest);
	const roleImages = {
		api: manifestRoleImage('api', manifest),
		manager: manifestRoleImage('manager', manifest),
		runner: manifestRoleImage('runner', manifest),
	};
	const composeEnv = {
		...(manifest.provider?.dataDir ? { TREESEED_PROVIDER_HOST_DATA_DIR: manifest.provider.dataDir } : {}),
		...(manifest.provider?.environment ? { TREESEED_PROVIDER_ENVIRONMENT: manifest.provider.environment } : {}),
		...(manifest.provider?.market?.url ? { TREESEED_MARKET_URL: manifest.provider.market.url } : {}),
		...(manifest.provider?.market?.id ? { TREESEED_MANAGER_ID: manifest.provider.market.id, TREESEED_MARKET_ID: manifest.provider.market.id } : {}),
		...(manifest.runtime?.api?.port ? { TREESEED_PROVIDER_API_PORT: String(manifest.runtime.api.port) } : {}),
		...(manifest.runtime?.api?.hostPort ? { TREESEED_PROVIDER_HOST_API_PORT: String(manifest.runtime.api.hostPort) } : {}),
		...(manifest.runtime?.runners?.maxConcurrent ? { TREESEED_PROVIDER_MAX_CONCURRENT_RUNNERS: String(manifest.runtime.runners.maxConcurrent) } : {}),
		TREESEED_AGENT_API_IMAGE: roleImages.api,
		TREESEED_AGENT_MANAGER_IMAGE: roleImages.manager,
		TREESEED_AGENT_RUNNER_IMAGE: roleImages.runner,
	};
	return {
		manifest,
		roleImages,
		composeEnv,
		redactedEnv: redactCapacityProviderEnv(composeEnv),
	};
}

export function renderCapacityProviderSelfHostInstructions(input: CapacityProviderEnvironmentInput): CapacityProviderSelfHostInstructions {
	const env = resolveCapacityProviderEnvironment(input);
	return {
		composeFile: 'packages/agent/compose.capacity-provider.yml',
		commands: [
			'npm -w packages/agent run capacity-provider:build',
			'docker compose -f packages/agent/compose.capacity-provider.yml up',
		],
		env,
		redactedEnv: redactCapacityProviderEnv(env),
		summary: 'Unlock TreeSeed sensitive config, inject these values into the docker compose process environment, and start the package-owned capacity provider runtime.',
	};
}

function providerDeploymentServiceName(prefix: string, role: CapacityProviderDeploymentServiceRole) {
	return `${prefix}-${role}`.replace(/[^a-zA-Z0-9_.-]+/gu, '-').replace(/^-+|-+$/gu, '').toLowerCase();
}

function providerDeploymentStartCommand(role: CapacityProviderDeploymentServiceRole) {
	return `node ./dist/provider/entrypoint.js ${role}`;
}

function defaultProviderDeploymentAdapter(hostKind: string): CapacityProviderDeploymentAdapter {
	return {
		async provisionService(spec) {
			return {
				role: spec.role,
				serviceName: spec.serviceName,
				serviceId: `${hostKind}:${spec.serviceName}`,
				url: spec.role === 'api' ? `https://${spec.serviceName}.example.invalid` : null,
				status: 'deployed',
				envRefs: Object.fromEntries(
					Object.keys(spec.env).map((key) => [key, isCapacityProviderSecretEnvKey(key) ? `${spec.serviceName}:${key}` : spec.redactedEnv[key] ?? spec.env[key]]),
				),
			};
		},
	};
}

async function deployCapacityProviderWithAdapter(
	input: CapacityProviderDeploymentPrimitiveInput,
	launchMode: CapacityProviderLaunchMode,
	hostKind: string,
): Promise<CapacityProviderDeploymentPrimitiveResult> {
	const imageRef = input.imageRef ?? input.intent.imageRef ?? 'treeseed/agent-api:latest';
	const roleImageRefs = {
		api: input.roleImageRefs?.api ?? imageRef,
		manager: input.roleImageRefs?.manager ?? input.imageRef ?? input.intent.imageRef ?? 'treeseed/agent-manager:latest',
		runner: input.roleImageRefs?.runner ?? input.imageRef ?? input.intent.imageRef ?? 'treeseed/agent-runner:latest',
	};
	const serviceNamePrefix = input.serviceNamePrefix
		?? `${input.intent.capacityProviderId || 'capacity-provider'}`
			.replace(/^cp[_-]?/u, 'capacity-provider-')
			.replace(/[^a-zA-Z0-9_.-]+/gu, '-');
	const env = { ...input.env };
	const redactedEnv = input.redactedEnv ?? redactCapacityProviderEnv(env);
	const adapter = input.adapter ?? defaultProviderDeploymentAdapter(hostKind);
	const services = {} as Record<CapacityProviderDeploymentServiceRole, CapacityProviderDeploymentServiceResult>;
	const diagnostics: string[] = [];
	try {
		for (const role of CAPACITY_PROVIDER_DEPLOYMENT_SERVICE_ROLES) {
			const result = await adapter.provisionService({
				role,
				serviceName: providerDeploymentServiceName(serviceNamePrefix, role),
				imageRef: roleImageRefs[role],
				startCommand: providerDeploymentStartCommand(role),
				env,
				redactedEnv,
			});
			services[role] = {
				role,
				serviceName: result.serviceName,
				serviceId: result.serviceId ?? null,
				url: result.url ?? null,
				status: result.status ?? 'deployed',
				envRefs: result.envRefs ?? {},
				metadata: result.metadata ?? {},
			};
		}
		return {
			ok: true,
			launchMode,
			hostKind,
			imageRef,
			status: 'deployed',
			serviceRefs: services,
			envRefs: Object.fromEntries(Object.keys(env).map((key) => [key, isCapacityProviderSecretEnvKey(key) ? '<host-secret>' : redactedEnv[key] ?? env[key]])),
			diagnostics,
			deployedAt: (input.now ?? new Date()).toISOString(),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			launchMode,
			hostKind,
			imageRef,
			status: 'failed',
			serviceRefs: services,
			envRefs: Object.fromEntries(Object.keys(env).map((key) => [key, isCapacityProviderSecretEnvKey(key) ? '<host-secret>' : redactedEnv[key] ?? env[key]])),
			diagnostics: [message],
			deployedAt: null,
			error: { message },
		};
	}
}

export function deployCapacityProviderToRailway(input: CapacityProviderDeploymentPrimitiveInput) {
	return deployCapacityProviderWithAdapter(input, 'connected_host', 'railway');
}

export function deployCapacityProviderToManagedMarketHost(input: CapacityProviderDeploymentPrimitiveInput) {
	return deployCapacityProviderWithAdapter(input, 'managed_market_host', 'managed_market_host');
}

export class MarketProviderClient {
	private readonly marketUrl: string;
	private readonly marketId: string;
	private apiKey: string;
	private readonly fetchImpl: typeof fetch;
	private readonly userAgent?: string;

	constructor(options: MarketProviderClientOptions) {
		this.marketUrl = normalizeBaseUrl(options.marketUrl);
		this.marketId = options.marketId.trim();
		this.apiKey = options.apiKey.trim();
		if (!this.apiKey) throw new Error('Capacity provider API key is required.');
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.userAgent = options.userAgent;
	}

	private async requestJson<T>(path: string, options: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
		const headers: Record<string, string> = {
			accept: 'application/json',
			[TREESEED_REMOTE_CONTRACT_HEADER]: String(TREESEED_REMOTE_CONTRACT_VERSION),
			...buildCapacityProviderAuthHeaders(this.apiKey),
		};
		if (this.userAgent) headers['user-agent'] = this.userAgent;
		if (options.body !== undefined) headers['content-type'] = 'application/json';
		const response = await this.fetchImpl(`${this.marketUrl}${path}`, {
			method: options.method ?? 'GET',
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
		});
		const payload = await response.json().catch(() => ({}));
		if (!response.ok) {
			const message = isRecord(payload) && typeof payload.error === 'string'
				? payload.error
				: `Capacity provider request failed with ${response.status}.`;
			throw new CapacityProviderApiError(message, response.status, payload);
		}
		return payload as T;
	}

	register(request: Omit<CapacityProviderRegistrationRequest, 'marketId'> & { marketId?: string }) {
		const marketId = request.marketId ?? this.marketId;
		const body = marketId ? { ...request, marketId } : request;
		return this.requestJson<CapacityProviderRegistrationResponse>(CAPACITY_PROVIDER_ENDPOINTS.register, {
			method: 'POST',
			body,
		}).then((response) => {
			assertCapacityProviderRegistrationResponse(response);
			if (typeof response.sessionToken === 'string' && response.sessionToken.trim()) {
				this.apiKey = response.sessionToken.trim();
			}
			return response;
		});
	}

	heartbeat(request: Omit<CapacityProviderHeartbeatRequest, 'marketId'> & { marketId?: string } = {}) {
		const marketId = request.marketId ?? this.marketId;
		const body = marketId ? { ...request, marketId } : request;
		return this.requestJson<CapacityProviderHeartbeatResponse>(CAPACITY_PROVIDER_ENDPOINTS.heartbeat, {
			method: 'POST',
			body,
		}).then((response) => {
			assertCapacityProviderOkEnvelope(response, 'Capacity provider heartbeat response');
			return response;
		});
	}

	createAvailabilitySession(request: Record<string, unknown> = {}) {
		return this.requestJson<{ ok: true; payload: Record<string, unknown> }>(CAPACITY_PROVIDER_ENDPOINTS.sessions, {
			method: 'POST',
			body: request,
		}).then((response) => {
			assertCapacityProviderOkEnvelope(response, 'Capacity provider availability session response');
			return response;
		});
	}

	checkIn(request: ProviderCheckInRequest = {}) {
		return this.requestJson<{ ok: true; payload: Record<string, unknown> }>(CAPACITY_PROVIDER_ENDPOINTS.checkIn, {
			method: 'POST',
			body: request,
		}).then((response) => {
			assertCapacityProviderOkEnvelope(response, 'Capacity provider check-in response');
			return response;
		});
	}

	portfolio() {
		return this.requestJson<CapacityProviderPortfolioManifest>(CAPACITY_PROVIDER_ENDPOINTS.portfolio).then((response) => {
			assertCapacityProviderPortfolioManifest(response);
			return response;
		});
	}

	createWorkday(request: ProviderWorkdayRequest) {
		return this.requestJson<ProviderWorkdayResponse>(CAPACITY_PROVIDER_ENDPOINTS.workdays, {
			method: 'POST',
			body: request,
		}).then((response) => {
			assertCapacityProviderOkEnvelope(response, 'Capacity provider workday response');
			return response;
		});
	}

	assignment(assignmentId: string) {
		return this.requestJson<{ ok: true; payload: Record<string, unknown> }>(CAPACITY_PROVIDER_ENDPOINTS.assignment(assignmentId)).then((response) => {
			assertCapacityProviderOkEnvelope(response, 'Capacity provider assignment response');
			return response;
		});
	}

	assignmentExplanation(assignmentId: string) {
		return this.requestJson<{ ok: true; payload: Record<string, unknown> }>(CAPACITY_PROVIDER_ENDPOINTS.assignmentExplanation(assignmentId)).then((response) => {
			assertCapacityProviderOkEnvelope(response, 'Capacity provider assignment explanation response');
			return response;
		});
	}

	nextAssignment(request: ProviderNextAssignmentRequest = {}) {
		return this.requestJson<ProviderAssignmentLifecycleResult>(CAPACITY_PROVIDER_ENDPOINTS.nextAssignment, {
			method: 'POST',
			body: request,
		}).then((response) => {
			assertCapacityProviderOkEnvelope(response, 'Capacity provider next assignment response');
			return response;
		});
	}

	renewAssignment(assignmentId: string, request: ProviderAssignmentLifecycleRequest = {}) {
		return this.requestJson<ProviderAssignmentLifecycleResult>(CAPACITY_PROVIDER_ENDPOINTS.assignmentRenew(assignmentId), {
			method: 'POST',
			body: request,
		}).then((response) => {
			assertCapacityProviderOkEnvelope(response, 'Capacity provider assignment renew response');
			return response;
		});
	}

	returnAssignment(assignmentId: string, request: ProviderAssignmentLifecycleRequest = {}) {
		return this.requestJson<ProviderAssignmentLifecycleResult>(CAPACITY_PROVIDER_ENDPOINTS.assignmentReturn(assignmentId), {
			method: 'POST',
			body: request,
		}).then((response) => {
			assertCapacityProviderOkEnvelope(response, 'Capacity provider assignment return response');
			return response;
		});
	}

	completeAssignment(assignmentId: string, request: ProviderAssignmentLifecycleRequest = {}) {
		return this.requestJson<ProviderAssignmentLifecycleResult>(CAPACITY_PROVIDER_ENDPOINTS.assignmentComplete(assignmentId), {
			method: 'POST',
			body: request,
		}).then((response) => {
			assertCapacityProviderOkEnvelope(response, 'Capacity provider assignment complete response');
			return response;
		});
	}

	failAssignment(assignmentId: string, request: ProviderAssignmentLifecycleRequest = {}) {
		return this.requestJson<ProviderAssignmentLifecycleResult>(CAPACITY_PROVIDER_ENDPOINTS.assignmentFail(assignmentId), {
			method: 'POST',
			body: request,
		}).then((response) => {
			assertCapacityProviderOkEnvelope(response, 'Capacity provider assignment fail response');
			return response;
		});
	}

	createAssignmentModeRun(assignmentId: string, request: Record<string, unknown>) {
		return this.requestJson<{ ok: true; payload: Record<string, unknown> }>(CAPACITY_PROVIDER_ENDPOINTS.assignmentModeRuns(assignmentId), {
			method: 'POST',
			body: request,
		}).then((response) => {
			assertCapacityProviderOkEnvelope(response, 'Capacity provider mode run response');
			return response;
		});
	}

	dispatchAssignmentWorkflowOperation(assignmentId: string, operationId: string, request: Record<string, unknown>) {
		return this.requestJson<{ ok: true; payload: Record<string, unknown> }>(CAPACITY_PROVIDER_ENDPOINTS.assignmentWorkflowOperationDispatch(assignmentId, operationId), {
			method: 'POST',
			body: request,
		}).then((response) => {
			assertCapacityProviderOkEnvelope(response, 'Capacity provider workflow operation dispatch response');
			return response;
		});
	}

	reportUsage(request: ProviderUsageReport) {
		return this.requestJson<ProviderUsageReportResponse>(CAPACITY_PROVIDER_ENDPOINTS.usage, {
			method: 'POST',
			body: request,
		}).then((response) => {
			assertCapacityProviderOkEnvelope(response, 'Capacity provider usage response');
			return response;
		});
	}

	writeReport(request: ProviderReportRequest) {
		return this.requestJson<ProviderReportResponse>(CAPACITY_PROVIDER_ENDPOINTS.reports, {
			method: 'POST',
			body: request,
		}).then((response) => {
			assertCapacityProviderOkEnvelope(response, 'Capacity provider report response');
			return response;
		});
	}
}
