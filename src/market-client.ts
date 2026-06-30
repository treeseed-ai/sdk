import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type {
	ApiPrincipal,
	DeviceCodePollRequest,
	DeviceCodePollResponse,
	DeviceCodeStartRequest,
	DeviceCodeStartResponse,
	TokenRefreshRequest,
	TokenRefreshResponse,
} from './remote.ts';
import type {
	CreateProjectWebDeploymentRequest,
	CreateProjectWebDeploymentResponse,
	ProjectDeployment,
	ProjectDeploymentActionAvailability,
	ProjectDeploymentEnvironment,
	ProjectDeploymentEvent,
	ProjectDeploymentReadiness,
	ProjectRepositoryTopology,
	ProjectWebDeploymentAction,
	TreeDxInstance,
	TreeDxMirror,
	TreeDxProjectLibraryBinding,
	TreeDxShareLink,
} from './sdk-types.ts';
import type {
	TreeseedGitHubActionsEncryptedSecretDeployment,
	TreeseedGitHubActionsSecretPublicKeyMetadata,
} from './secrets-capability.ts';
import type { TreeseedRepositoryImportPlan } from './project-import.ts';
import {
	TREESEED_REMOTE_CONTRACT_HEADER,
	TREESEED_REMOTE_CONTRACT_VERSION,
} from './remote.ts';
import {
	resolveTreeseedRemoteSession,
	setTreeseedRemoteSession,
	clearTreeseedRemoteSession,
} from './operations/services/config-runtime.ts';

export const DEFAULT_TREESEED_MARKET_BASE_URL = 'https://api.treeseed.dev';
export const TREESEED_CENTRAL_MARKET_API_BASE_URL_ENV = 'TREESEED_CENTRAL_MARKET_API_BASE_URL';
export const TREESEED_API_BASE_URL_ENV = 'TREESEED_API_BASE_URL';
export const TREESEED_CATALOG_MARKET_API_BASE_URLS_ENV = 'TREESEED_CATALOG_MARKET_API_BASE_URLS';

export type MarketProfileKind = 'central' | 'specialized';

export interface MarketProfile {
	id: string;
	label: string;
	baseUrl: string;
	kind: MarketProfileKind;
	teamId?: string | null;
	alwaysAvailable?: boolean;
}

export interface MarketSession {
	marketId: string;
	accessToken: string;
	refreshToken?: string;
	expiresAt?: string;
	principal?: ApiPrincipal | null;
}

export interface MarketWebAuthSession {
	accessToken: string;
	refreshToken?: string | null;
	expiresInSeconds?: number;
	principal: ApiPrincipal;
	session?: Record<string, unknown> | null;
}

export interface MarketUserEmailAddress {
	id: string;
	userId: string;
	email: string;
	status: string;
	verified: boolean;
	isPrimary: boolean;
	verificationRequestedAt?: string | null;
	verifiedAt?: string | null;
	createdAt?: string | null;
	updatedAt?: string | null;
}

export interface MarketRegistryState {
	version: 1;
	activeMarketId: string;
	profiles: MarketProfile[];
}

export interface TeamAccessSummary {
	teamId: string;
	roles: string[];
	permissions: string[];
	summary: {
		canAdminStaging: boolean;
		canAdminProduction: boolean;
		canDownloadTemplates: boolean;
		canDownloadKnowledgePacks: boolean;
	};
}

export interface ProjectEnvironmentAccess {
	projectId: string;
	environment: 'staging' | 'prod' | string;
	subjectType: 'user' | 'team_role' | 'api_key' | string;
	subjectId: string;
	role: 'viewer' | 'operator' | 'admin' | string;
}

export interface CatalogArtifactDownload {
	itemId: string;
	slug?: string;
	kind: string;
	version: string;
	contentType: string;
	sha256?: string | null;
	downloadUrl: string;
	expiresAt?: string | null;
	installStrategy?: string | null;
}

export interface MarketCatalogSource {
	id: string;
	label: string;
	baseUrl: string;
	kind: MarketProfileKind;
	teamId?: string | null;
}

export type MarketSourcedCatalogItem<T extends Record<string, unknown> = Record<string, unknown>> = T & {
	sourceMarket: MarketCatalogSource;
};

export type MarketSourcedCatalogArtifactDownload = CatalogArtifactDownload & {
	sourceMarket: MarketCatalogSource;
};

export interface IntegratedMarketCatalogResult<T extends Record<string, unknown> = Record<string, unknown>> {
	ok: true;
	payload: Array<MarketSourcedCatalogItem<T>>;
	errors: Array<{
		market: MarketCatalogSource;
		status?: number;
		error: string;
	}>;
}

export interface MarketProjectDeploymentState {
	ok: true;
	project: Record<string, unknown>;
	launch: Record<string, unknown> | null;
	environments: unknown[];
	repositories: unknown[];
	hosts: unknown[];
	runner: Record<string, unknown>;
	latestDeployments: {
		staging: ProjectDeployment | null;
		prod: ProjectDeployment | null;
	};
	latestMonitors: {
		staging: Record<string, unknown> | null;
		prod: Record<string, unknown> | null;
	};
	activeOperations: ProjectDeployment[];
	recentDeployments: ProjectDeployment[];
	readiness: ProjectDeploymentReadiness;
	actions: ProjectDeploymentActionAvailability[];
	target: Record<string, unknown> | null;
}

export interface ProjectDeploymentListFilters {
	environment?: ProjectDeploymentEnvironment | string | null;
	action?: ProjectWebDeploymentAction | string | null;
	status?: string | null;
	limit?: number | string | null;
}

export interface MarketClientOptions {
	profile: MarketProfile;
	accessToken?: string | null;
	fetchImpl?: typeof fetch;
	userAgent?: string;
}

const MARKET_REGISTRY_RELATIVE_PATH = '.treeseed/config/markets.json';
function envValue(name: string, env: Record<string, string | undefined> = process.env) {
	return typeof env[name] === 'string' && env[name]!.trim().length > 0 ? env[name]!.trim() : null;
}

export function resolveDefaultCentralMarketBaseUrl(env: Record<string, string | undefined> = process.env) {
	return normalizeBaseUrl(
			envValue(TREESEED_CENTRAL_MARKET_API_BASE_URL_ENV, env)
			?? DEFAULT_TREESEED_MARKET_BASE_URL,
		);
}

function defaultCentralMarket(): MarketProfile {
	return {
		id: 'central',
		label: 'TreeSeed Central Market',
		baseUrl: resolveDefaultCentralMarketBaseUrl(),
		kind: 'central',
		alwaysAvailable: true,
	};
}

function defaultLocalMarket(env: Record<string, string | undefined> = process.env): MarketProfile {
	return {
		id: 'local',
		label: 'Local TreeSeed Market',
		baseUrl: normalizeBaseUrl(
			envValue(TREESEED_API_BASE_URL_ENV, env)
			?? 'http://127.0.0.1:3000',
		),
		kind: 'specialized',
		alwaysAvailable: true,
	};
}

function homeConfigPath() {
	const homeRoot = process.env.HOME && process.env.HOME.trim().length > 0 ? process.env.HOME : homedir();
	return resolve(homeRoot, MARKET_REGISTRY_RELATIVE_PATH);
}

function normalizeBaseUrl(baseUrl: string) {
	return baseUrl.trim().replace(/\/+$/u, '');
}

function normalizeProfile(profile: MarketProfile): MarketProfile {
	return {
		...profile,
		id: profile.id.trim(),
		label: profile.label.trim() || profile.id.trim(),
		baseUrl: normalizeBaseUrl(profile.baseUrl),
		kind: profile.kind === 'specialized' ? 'specialized' : 'central',
		teamId: profile.teamId ?? null,
		alwaysAvailable: profile.alwaysAvailable === true || profile.id === 'central',
	};
}

function uniqueProfiles(profiles: MarketProfile[]) {
	const byId = new Map<string, MarketProfile>();
	for (const profile of [defaultCentralMarket(), ...profiles].map(normalizeProfile)) {
		if (profile.id === 'central') {
			profile.baseUrl = resolveDefaultCentralMarketBaseUrl();
			profile.label = profile.label || 'TreeSeed Central Market';
			profile.kind = 'central';
			profile.alwaysAvailable = true;
		}
		byId.set(profile.id, profile);
	}
	return [...byId.values()].sort((left, right) => {
		if (left.id === 'central') return -1;
		if (right.id === 'central') return 1;
		return left.id.localeCompare(right.id);
	});
}

export function loadMarketRegistryState(): MarketRegistryState {
	const path = homeConfigPath();
	if (!existsSync(path)) {
		return {
			version: 1,
			activeMarketId: 'central',
			profiles: [defaultCentralMarket()],
		};
	}
	const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<MarketRegistryState>;
	const profiles = uniqueProfiles(Array.isArray(parsed.profiles) ? parsed.profiles : []);
	const activeMarketId = typeof parsed.activeMarketId === 'string' && profiles.some((profile) => profile.id === parsed.activeMarketId)
		? parsed.activeMarketId
		: 'central';
	return {
		version: 1,
		activeMarketId,
		profiles,
	};
}

export function writeMarketRegistryState(state: MarketRegistryState) {
	const path = homeConfigPath();
	mkdirSync(dirname(path), { recursive: true });
	const profiles = uniqueProfiles(state.profiles);
	const activeMarketId = profiles.some((profile) => profile.id === state.activeMarketId) ? state.activeMarketId : 'central';
	const next: MarketRegistryState = {
		version: 1,
		activeMarketId,
		profiles,
	};
	writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
	return next;
}

export function addMarketProfile(profile: MarketProfile) {
	const state = loadMarketRegistryState();
	return writeMarketRegistryState({
		...state,
		profiles: uniqueProfiles([...state.profiles, profile]),
	});
}

export function removeMarketProfile(id: string) {
	if (id === 'central') {
		throw new Error('The central market profile cannot be removed.');
	}
	const state = loadMarketRegistryState();
	return writeMarketRegistryState({
		...state,
		activeMarketId: state.activeMarketId === id ? 'central' : state.activeMarketId,
		profiles: state.profiles.filter((profile) => profile.id !== id),
	});
}

export function setActiveMarketProfile(id: string) {
	const state = loadMarketRegistryState();
	if (!state.profiles.some((profile) => profile.id === id)) {
		throw new Error(`Unknown market profile "${id}".`);
	}
	return writeMarketRegistryState({
		...state,
		activeMarketId: id,
	});
}

export function resolveMarketProfile(selector?: string | null): MarketProfile {
	const state = loadMarketRegistryState();
	const trimmed = selector?.trim();
	if (trimmed && /^https?:\/\//iu.test(trimmed)) {
		return {
			id: trimmed.replace(/^https?:\/\//iu, '').replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'market',
			label: trimmed,
			baseUrl: normalizeBaseUrl(trimmed),
			kind: 'specialized',
			alwaysAvailable: false,
		};
	}
	if (trimmed === 'local') {
		return defaultLocalMarket();
	}
	const marketId = trimmed || state.activeMarketId || 'central';
	const profile = state.profiles.find((entry) => entry.id === marketId);
	if (!profile) {
		throw new Error(`Unknown market profile "${marketId}".`);
	}
	return profile;
}

export function resolveMarketSession(tenantRoot: string, marketId: string): MarketSession | null {
	let session;
	try {
		session = resolveTreeseedRemoteSession(tenantRoot, marketId);
	} catch {
		return null;
	}
	return session?.accessToken
		? {
			marketId,
			accessToken: session.accessToken,
			refreshToken: session.refreshToken,
			expiresAt: session.expiresAt,
			principal: session.principal ?? null,
		}
		: null;
}

export function setMarketSession(tenantRoot: string, session: MarketSession) {
	return setTreeseedRemoteSession(tenantRoot, {
		hostId: session.marketId,
		accessToken: session.accessToken,
		refreshToken: session.refreshToken ?? '',
		expiresAt: session.expiresAt ?? '',
		principal: session.principal ?? null,
	});
}

export function clearMarketSession(tenantRoot: string, marketId?: string | null) {
	return clearTreeseedRemoteSession(tenantRoot, marketId ?? undefined);
}

function profileToSource(profile: MarketProfile): MarketCatalogSource {
	return {
		id: profile.id,
		label: profile.label,
		baseUrl: profile.baseUrl,
		kind: profile.kind,
		teamId: profile.teamId ?? null,
	};
}

function catalogProfileIdForUrl(baseUrl: string) {
	const id = normalizeBaseUrl(baseUrl)
		.replace(/^https?:\/\//iu, '')
		.replace(/[^A-Za-z0-9._-]+/gu, '-')
		.replace(/^-+|-+$/gu, '');
	return id ? `catalog-${id}` : 'catalog-market';
}

function parseCatalogMarketBaseUrls(env: Record<string, string | undefined> = process.env) {
	const raw = envValue(TREESEED_CATALOG_MARKET_API_BASE_URLS_ENV, env);
	if (!raw) return [];
	return raw
		.split(/[\s,]+/u)
		.map((value) => value.trim())
		.filter(Boolean);
}

export function resolveCatalogMarketProfiles(selector?: string | null, env: Record<string, string | undefined> = process.env): MarketProfile[] {
	if (selector?.trim()) {
		return [resolveMarketProfile(selector)];
	}
	const state = loadMarketRegistryState();
	const byKey = new Map<string, MarketProfile>();
	for (const profile of uniqueProfiles(state.profiles)) {
		byKey.set(normalizeBaseUrl(profile.baseUrl), profile);
	}
	for (const baseUrl of parseCatalogMarketBaseUrls(env)) {
		const normalized = normalizeBaseUrl(baseUrl);
		if (!byKey.has(normalized)) {
			byKey.set(normalized, {
				id: catalogProfileIdForUrl(normalized),
				label: normalized,
				baseUrl: normalized,
				kind: normalized === resolveDefaultCentralMarketBaseUrl(env) ? 'central' : 'specialized',
				alwaysAvailable: normalized === resolveDefaultCentralMarketBaseUrl(env),
			});
		}
	}
	return [...byKey.values()].sort((left, right) => {
		if (left.id === 'central') return -1;
		if (right.id === 'central') return 1;
		return left.id.localeCompare(right.id);
	});
}

export class MarketClientError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly payload: unknown,
	) {
		super(message);
		this.name = 'MarketClientError';
	}
}

export class MarketClient {
	private readonly baseUrl: string;
	private readonly accessToken: string | null;
	private readonly fetchImpl: typeof fetch;
	private readonly userAgent?: string;

	constructor(readonly options: MarketClientOptions) {
		this.baseUrl = normalizeBaseUrl(options.profile.baseUrl);
		this.accessToken = options.accessToken ?? null;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.userAgent = options.userAgent;
	}

	private async request<T>(path: string, options: { method?: string; body?: unknown; requireAuth?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
		const headers: Record<string, string> = {
			accept: 'application/json',
			[TREESEED_REMOTE_CONTRACT_HEADER]: String(TREESEED_REMOTE_CONTRACT_VERSION),
			...(options.headers ?? {}),
		};
		if (this.userAgent) {
			headers['user-agent'] = this.userAgent;
		}
		if (options.body !== undefined) {
			headers['content-type'] = 'application/json';
		}
		if ((options.requireAuth ?? false) && this.accessToken) {
			headers.authorization = `Bearer ${this.accessToken}`;
		}

		const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
			method: options.method ?? 'GET',
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
		});
		const payload = await response.json().catch(() => ({}));
		if (!response.ok) {
			const payloadError = (payload as { error?: unknown }).error;
			const error = typeof payloadError === 'string'
				? String(payloadError)
				: payloadError && typeof payloadError === 'object' && typeof (payloadError as { message?: unknown }).message === 'string'
					? String((payloadError as { message: string }).message)
					: `Market request failed with ${response.status}.`;
			throw new MarketClientError(error, response.status, payload);
		}
		return payload as T;
	}

	private localAuthPaths(v1Path: string, legacyPath: string) {
		return this.options.profile.id === 'local' ? [legacyPath, v1Path] : [v1Path];
	}

	private async requestFirst<T>(paths: string[], options: { method?: string; body?: unknown; requireAuth?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
		let notFound: MarketClientError | null = null;
		for (const path of paths) {
			try {
				return await this.request<T>(path, options);
			} catch (error) {
				if (error instanceof MarketClientError && error.status === 404) {
					notFound = error;
					continue;
				}
				throw error;
			}
		}
		throw notFound ?? new MarketClientError('Market request failed with 404.', 404, {});
	}

	startDeviceLogin(request: DeviceCodeStartRequest) {
		return this.requestFirst<DeviceCodeStartResponse>(this.localAuthPaths('/v1/auth/device/start', '/auth/device/start'), {
			method: 'POST',
			body: request,
		});
	}

	pollDeviceLogin(request: DeviceCodePollRequest) {
		return this.requestFirst<DeviceCodePollResponse>(this.localAuthPaths('/v1/auth/device/poll', '/auth/device/poll'), {
			method: 'POST',
			body: request,
		});
	}

	refreshToken(request: TokenRefreshRequest) {
		return this.requestFirst<TokenRefreshResponse>(this.localAuthPaths('/v1/auth/token/refresh', '/auth/token/refresh'), {
			method: 'POST',
			body: request,
		});
	}

	logout() {
		return this.request<{ ok: true }>('/v1/auth/logout', {
			method: 'POST',
			requireAuth: true,
		});
	}

	webSignUp(body: {
		email: string;
		password: string;
		username?: string | null;
		name?: string | null;
		firstName?: string | null;
		lastName?: string | null;
	}) {
		return this.request<{ ok: true; payload: MarketWebAuthSession }>('/v1/auth/web/sign-up', {
			method: 'POST',
			body,
		});
	}

	webSignIn(body: { email?: string; username?: string; login?: string; password: string }) {
		return this.request<{ ok: true; payload: MarketWebAuthSession }>('/v1/auth/web/sign-in', {
			method: 'POST',
			body,
		});
	}

	confirmWebEmail(body: { token: string }) {
		return this.request<{ ok: true; payload: MarketWebAuthSession }>('/v1/auth/web/confirm-email', {
			method: 'POST',
			body,
		});
	}

	checkWebUsername(username: string) {
		return this.request<{ ok: true; payload: { username: string; available: boolean; status: string } }>(
			`/v1/auth/web/username/check?username=${encodeURIComponent(username)}`,
		);
	}

	webEmails() {
		return this.request<{ ok: true; payload: MarketUserEmailAddress[] }>('/v1/auth/web/emails', { requireAuth: true });
	}

	addWebEmail(body: { email: string }) {
		return this.request<{ ok: true; payload: { emailAddress: MarketUserEmailAddress; verificationSent: boolean; confirmationToken?: string } }>('/v1/auth/web/emails', {
			method: 'POST',
			body,
			requireAuth: true,
		});
	}

	verifyWebEmail(emailId: string) {
		return this.request<{ ok: true; payload: { emailAddress: MarketUserEmailAddress; verificationSent: boolean; confirmationToken?: string } }>(
			`/v1/auth/web/emails/${encodeURIComponent(emailId)}/verify`,
			{ method: 'POST', requireAuth: true },
		);
	}

	setPrimaryWebEmail(emailId: string) {
		return this.request<{ ok: true; payload: MarketWebAuthSession & { emailAddress: MarketUserEmailAddress } }>(
			`/v1/auth/web/emails/${encodeURIComponent(emailId)}/primary`,
			{ method: 'POST', requireAuth: true },
		);
	}

	deleteWebEmail(emailId: string) {
		return this.request<{ ok: true; payload: MarketUserEmailAddress[] }>(
			`/v1/auth/web/emails/${encodeURIComponent(emailId)}`,
			{ method: 'DELETE', requireAuth: true },
		);
	}

	webSessions() {
		return this.request<{ ok: true; payload: unknown[] }>('/v1/auth/web/sessions', { requireAuth: true });
	}

	revokeWebSession(sessionId: string) {
		return this.request<{ ok: true; payload: { sessionId: string } }>(
			`/v1/auth/web/sessions/${encodeURIComponent(sessionId)}/revoke`,
			{ method: 'POST', requireAuth: true },
		);
	}

	updateWebProfile(body: { name?: string | null; image?: string | null }) {
		return this.request<{ ok: true; payload: MarketWebAuthSession }>('/v1/auth/web/profile', {
			method: 'PATCH',
			body,
			requireAuth: true,
		});
	}

	webAppearance() {
		return this.request<{ ok: true; payload: { scheme: string; mode: string } }>('/v1/auth/web/appearance', { requireAuth: true });
	}

	updateWebAppearance(body: { colorScheme?: string | null; scheme?: string | null; themeMode?: string | null; mode?: string | null }) {
		return this.request<{ ok: true; payload: { scheme: string; mode: string } }>('/v1/auth/web/appearance', {
			method: 'PATCH',
			body,
			requireAuth: true,
		});
	}

	updateWebEmail(body: { email: string }) {
		return this.request<{ ok: true; payload: MarketWebAuthSession }>('/v1/auth/web/email', {
			method: 'PATCH',
			body,
			requireAuth: true,
		});
	}

	updateWebPassword(body: { currentPassword?: string; password: string }) {
		return this.request<{ ok: true; payload: { changed: true } }>('/v1/auth/web/password', {
			method: 'PATCH',
			body,
			requireAuth: true,
		});
	}

	requestWebPasswordReset(body: { email: string }) {
		return this.request<{ ok: true; payload: { sent: true; resetToken?: string | null } }>('/v1/auth/web/password-reset/request', {
			method: 'POST',
			body,
		});
	}

	completeWebPasswordReset(body: { token: string; password: string }) {
		return this.request<{ ok: true; payload: { reset: true } }>('/v1/auth/web/password-reset/complete', {
			method: 'POST',
			body,
		});
	}

	accountDeletionBlockers() {
		return this.request<{ ok: true; payload: { blockers: unknown[]; canDelete: boolean } }>('/v1/auth/web/account/deletion-blockers', { requireAuth: true });
	}

	deleteAccount(body: { confirmation?: string } = {}) {
		return this.request<{ ok: true; payload: { deleted: true } }>('/v1/auth/web/account', {
			method: 'DELETE',
			body,
			requireAuth: true,
		});
	}

	me() {
		return this.request<{ ok: true; payload: { principal: ApiPrincipal; teams: unknown[] } }>('/v1/me', { requireAuth: true });
	}

	markets() {
		return this.request<{ ok: true; payload: MarketProfile[] }>('/v1/me/markets', { requireAuth: true });
	}

	currentMarket() {
		return this.request<{ ok: true; payload: MarketProfile }>('/v1/markets/current');
	}

	teams() {
		return this.request<{ ok: true; payload: unknown[] }>('/v1/teams', { requireAuth: true });
	}

	teamMembers(teamId: string) {
		return this.request<{ ok: true; payload: unknown[] }>(`/v1/teams/${encodeURIComponent(teamId)}/members`, { requireAuth: true });
	}

	teamPermissions(teamId: string) {
		return this.request<{ ok: true; payload: TeamAccessSummary }>(`/v1/teams/${encodeURIComponent(teamId)}/permissions`, { requireAuth: true });
	}

	projects(teamId?: string | null) {
		const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
		return this.request<{ ok: true; payload: unknown[] }>(`/v1/projects${query}`, { requireAuth: true });
	}

	projectAccess(projectId: string) {
		return this.request<{ ok: true; payload: { projectId: string; team: TeamAccessSummary; environments: ProjectEnvironmentAccess[] } }>(
			`/v1/projects/${encodeURIComponent(projectId)}/access`,
			{ requireAuth: true },
		);
	}

	projectHosts(projectId: string) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/projects/${encodeURIComponent(projectId)}/hosts`,
			{ requireAuth: true },
		);
	}

	projectSecretEscrowRecords(projectId: string, filters: { secretId?: string | null; status?: string | null; limit?: number | null } = {}) {
		const query = new URLSearchParams();
		if (filters.secretId) query.set('secretId', String(filters.secretId));
		if (filters.status) query.set('status', String(filters.status));
		if (filters.limit) query.set('limit', String(filters.limit));
		return this.request<{ ok: true; payload: unknown[] }>(
			`/v1/projects/${encodeURIComponent(projectId)}/secrets/escrow${query.toString() ? `?${query}` : ''}`,
			{ requireAuth: true },
		);
	}

	createProjectSecretEscrow(projectId: string, body: Record<string, unknown>) {
		return this.request<{ ok: true; payload: unknown }>(
			`/v1/projects/${encodeURIComponent(projectId)}/secrets/escrow`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	projectSecretEscrow(projectId: string, escrowId: string) {
		return this.request<{ ok: true; payload: unknown }>(
			`/v1/projects/${encodeURIComponent(projectId)}/secrets/escrow/${encodeURIComponent(escrowId)}`,
			{ requireAuth: true },
		);
	}

	updateProjectSecretEscrow(projectId: string, escrowId: string, body: Record<string, unknown>) {
		return this.request<{ ok: true; payload: unknown }>(
			`/v1/projects/${encodeURIComponent(projectId)}/secrets/escrow/${encodeURIComponent(escrowId)}`,
			{ method: 'PATCH', body, requireAuth: true },
		);
	}

	migrateProjectSecretEscrow(projectId: string, escrowId: string, body: Record<string, unknown>) {
		return this.request<{ ok: true; payload: unknown }>(
			`/v1/projects/${encodeURIComponent(projectId)}/secrets/escrow/${encodeURIComponent(escrowId)}/migrate`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	tombstoneProjectSecretEscrow(projectId: string, escrowId: string) {
		return this.request<{ ok: true; payload: unknown }>(
			`/v1/projects/${encodeURIComponent(projectId)}/secrets/escrow/${encodeURIComponent(escrowId)}`,
			{ method: 'DELETE', requireAuth: true },
		);
	}

	projectGitHubActionsSecretPublicKey(projectId: string, input: {
		installationId?: string | null;
		repository: string;
		scope?: string | null;
		environment?: string | null;
	}) {
		const query = new URLSearchParams();
		if (input.installationId) query.set('installationId', String(input.installationId));
		query.set('repository', input.repository);
		if (input.scope) query.set('scope', String(input.scope));
		if (input.environment) query.set('environment', String(input.environment));
		return this.request<{ ok: true; payload: TreeseedGitHubActionsSecretPublicKeyMetadata }>(
			`/v1/projects/${encodeURIComponent(projectId)}/secrets/github-actions/public-key?${query}`,
			{ requireAuth: true },
		);
	}

	deployProjectGitHubActionsSecret(projectId: string, body: TreeseedGitHubActionsEncryptedSecretDeployment & Record<string, unknown>) {
		return this.request<{ ok: true; payload: unknown }>(
			`/v1/projects/${encodeURIComponent(projectId)}/secrets/github-actions/deploy`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	dispatchProjectWorkflowOperation(projectId: string, operationId: string, body: Record<string, unknown>) {
		return this.request<{ ok: true; payload: unknown }>(
			`/v1/projects/${encodeURIComponent(projectId)}/workflow-operations/${encodeURIComponent(operationId)}/dispatch`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	teamTreeDx(teamId: string) {
		return this.request<{ ok: true; payload: { instance: TreeDxInstance | null; mirrors: TreeDxMirror[]; shares: TreeDxShareLink[]; deployments: unknown[] } }>(
			`/v1/teams/${encodeURIComponent(teamId)}/treedx`,
			{ requireAuth: true },
		);
	}

	updateTeamTreeDx(teamId: string, body: Partial<TreeDxInstance> & Record<string, unknown>) {
		return this.request<{ ok: true; payload: { instance: TreeDxInstance } }>(
			`/v1/teams/${encodeURIComponent(teamId)}/treedx`,
			{ method: 'PUT', body, requireAuth: true },
		);
	}

	provisionTeamTreeDx(teamId: string, body: Record<string, unknown> = {}) {
		return this.request<{ ok: true; payload: { instance: TreeDxInstance | null; mirrors: TreeDxMirror[]; shares: TreeDxShareLink[]; deployments: unknown[] } }>(
			`/v1/teams/${encodeURIComponent(teamId)}/treedx/provision`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	treeDxMirrors(teamId: string) {
		return this.request<{ ok: true; payload: TreeDxMirror[] }>(
			`/v1/teams/${encodeURIComponent(teamId)}/treedx/mirrors`,
			{ requireAuth: true },
		);
	}

	createTreeDxMirror(teamId: string, body: Partial<TreeDxMirror> & Record<string, unknown>) {
		return this.request<{ ok: true; payload: TreeDxMirror }>(
			`/v1/teams/${encodeURIComponent(teamId)}/treedx/mirrors`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	syncTreeDxMirror(teamId: string, mirrorId: string, body: Record<string, unknown> = {}) {
		return this.request<{ ok: true; payload: TreeDxMirror }>(
			`/v1/teams/${encodeURIComponent(teamId)}/treedx/mirrors/${encodeURIComponent(mirrorId)}/sync`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	treeDxShares(teamId: string) {
		return this.request<{ ok: true; payload: TreeDxShareLink[] }>(
			`/v1/teams/${encodeURIComponent(teamId)}/treedx/shares`,
			{ requireAuth: true },
		);
	}

	createTreeDxShare(teamId: string, body: Partial<TreeDxShareLink> & Record<string, unknown>) {
		return this.request<{ ok: true; payload: TreeDxShareLink }>(
			`/v1/teams/${encodeURIComponent(teamId)}/treedx/shares`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	projectTreeDxLibrary(projectId: string) {
		return this.request<{ ok: true; payload: TreeDxProjectLibraryBinding | null }>(
			`/v1/projects/${encodeURIComponent(projectId)}/treedx-library`,
			{ requireAuth: true },
		);
	}

	upsertProjectTreeDxLibrary(projectId: string, body: Partial<TreeDxProjectLibraryBinding> & Record<string, unknown>) {
		return this.request<{ ok: true; payload: TreeDxProjectLibraryBinding }>(
			`/v1/projects/${encodeURIComponent(projectId)}/treedx-library`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	projectRepositoryTopology(projectId: string) {
		return this.request<{ ok: true; payload: ProjectRepositoryTopology }>(
			`/v1/projects/${encodeURIComponent(projectId)}/repository-topology`,
			{ requireAuth: true },
		);
	}

	projectTreeDxProxyAudit(projectId: string, options: { assignmentId?: string | null; actorType?: string | null } = {}) {
		const query = new URLSearchParams();
		if (options.assignmentId) query.set('assignmentId', options.assignmentId);
		if (options.actorType) query.set('actorType', options.actorType);
		return this.request<{ ok: true; payload: unknown[] }>(
			`/v1/projects/${encodeURIComponent(projectId)}/treedx-proxy-audit${query.toString() ? `?${query}` : ''}`,
			{ requireAuth: true },
		);
	}

	createCapacityReservation(projectId: string, body: Record<string, unknown>) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/projects/${encodeURIComponent(projectId)}/capacity/reservations`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	projectAgentFallbackOutputs(projectId: string, options: { assignmentId?: string | null; mode?: string | null; status?: string | null } = {}) {
		const query = new URLSearchParams();
		if (options.assignmentId) query.set('assignmentId', options.assignmentId);
		if (options.mode) query.set('mode', options.mode);
		if (options.status) query.set('status', options.status);
		return this.request<{ ok: true; payload: unknown[] }>(
			`/v1/projects/${encodeURIComponent(projectId)}/agent-fallback-outputs${query.toString() ? `?${query}` : ''}`,
			{ requireAuth: true },
		);
	}

	treeDxBuildContext(projectId: string, repoId: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
		return this.request<{ ok: true; payload: unknown }>(
			`/v1/dx/projects/${encodeURIComponent(projectId)}/repos/${encodeURIComponent(repoId)}/context/build`,
			{ method: 'POST', body, headers, requireAuth: true },
		);
	}

	treeDxReadRepositoryFiles(projectId: string, repoId: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
		return this.request<{ ok: true; payload: unknown }>(
			`/v1/dx/projects/${encodeURIComponent(projectId)}/repos/${encodeURIComponent(repoId)}/files/read`,
			{ method: 'POST', body, headers, requireAuth: true },
		);
	}

	createTreeDxWorkspace(projectId: string, repoId: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
		return this.request<{ ok: true; payload: unknown }>(
			`/v1/dx/projects/${encodeURIComponent(projectId)}/repos/${encodeURIComponent(repoId)}/workspaces`,
			{ method: 'POST', body, headers, requireAuth: true },
		);
	}

	updateProjectRepositoryTopology(projectId: string, body: ProjectRepositoryTopology | Record<string, unknown>) {
		return this.request<{ ok: true; payload: ProjectRepositoryTopology }>(
			`/v1/projects/${encodeURIComponent(projectId)}/repository-topology`,
			{ method: 'PUT', body, requireAuth: true },
		);
	}

	initializeProjectRepository(projectId: string, role: string, body: Record<string, unknown> = {}) {
		return this.request<{ ok: true; operation: Record<string, unknown> }>(
			`/v1/projects/${encodeURIComponent(projectId)}/repositories/${encodeURIComponent(role)}/initialize`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	importProjectRepository(teamId: string, plan: TreeseedRepositoryImportPlan | Record<string, unknown>) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/teams/${encodeURIComponent(teamId)}/projects/import`,
			{ method: 'POST', body: { plan }, requireAuth: true },
		);
	}

	auditProjectHosts(projectId: string, body: Record<string, unknown> = {}) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/projects/${encodeURIComponent(projectId)}/hosts/audit`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	replaceProjectHost(projectId: string, requirementKey: string, body: Record<string, unknown> = {}) {
		return this.request<{ ok: true; payload: Record<string, unknown>; operation: Record<string, unknown> }>(
			`/v1/projects/${encodeURIComponent(projectId)}/hosts/${encodeURIComponent(requirementKey)}/replace`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	resyncProjectHost(projectId: string, requirementKey: string, body: Record<string, unknown> = {}) {
		return this.request<{ ok: true; payload: Record<string, unknown>; operation: Record<string, unknown> }>(
			`/v1/projects/${encodeURIComponent(projectId)}/hosts/${encodeURIComponent(requirementKey)}/resync`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	rotateProjectHost(projectId: string, requirementKey: string, body: Record<string, unknown> = {}) {
		return this.request<{ ok: true; payload: Record<string, unknown>; operation: Record<string, unknown> }>(
			`/v1/projects/${encodeURIComponent(projectId)}/hosts/${encodeURIComponent(requirementKey)}/rotate`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	projectDeploymentState(projectId: string) {
		return this.request<MarketProjectDeploymentState>(
			`/v1/projects/${encodeURIComponent(projectId)}/deployment-state`,
			{ requireAuth: true },
		);
	}

	projectDeployments(projectId: string, filters: ProjectDeploymentListFilters = {}) {
		const query = new URLSearchParams();
		if (filters.environment) query.set('environment', String(filters.environment));
		if (filters.action) query.set('action', String(filters.action));
		if (filters.status) query.set('status', String(filters.status));
		if (filters.limit) query.set('limit', String(filters.limit));
		const suffix = query.size > 0 ? `?${query.toString()}` : '';
		return this.request<{ ok: true; payload: ProjectDeployment[] }>(
			`/v1/projects/${encodeURIComponent(projectId)}/deployments${suffix}`,
			{ requireAuth: true },
		);
	}

	projectDeployment(projectId: string, deploymentId: string) {
		return this.request<{ ok: true; payload: ProjectDeployment }>(
			`/v1/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deploymentId)}`,
			{ requireAuth: true },
		);
	}

	projectDeploymentById(deploymentId: string) {
		return this.request<{ ok: true; payload: ProjectDeployment }>(
			`/v1/project-deployments/${encodeURIComponent(deploymentId)}`,
			{ requireAuth: true },
		);
	}

	projectDeploymentEvents(projectId: string, deploymentId: string, options: { limit?: number | string | null } = {}) {
		const query = options.limit ? `?limit=${encodeURIComponent(String(options.limit))}` : '';
		return this.request<{ ok: true; payload: ProjectDeploymentEvent[] }>(
			`/v1/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deploymentId)}/events${query}`,
			{ requireAuth: true },
		);
	}

	createProjectWebDeployment(projectId: string, body: CreateProjectWebDeploymentRequest) {
		return this.request<CreateProjectWebDeploymentResponse>(
			`/v1/projects/${encodeURIComponent(projectId)}/deployments/web`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	retryProjectDeployment(projectId: string, deploymentId: string, body: Record<string, unknown> = {}) {
		return this.request<{ ok: true; originalDeployment: ProjectDeployment; retryDeployment: ProjectDeployment; operation: Record<string, unknown> }>(
			`/v1/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deploymentId)}/retry`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	resumeProjectDeployment(projectId: string, deploymentId: string, body: Record<string, unknown> = {}) {
		return this.request<Record<string, unknown>>(
			`/v1/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deploymentId)}/resume`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	cancelProjectDeployment(projectId: string, deploymentId: string, body: Record<string, unknown> = {}) {
		return this.request<{ ok: true; deployment: ProjectDeployment; cancellation: 'completed' | 'requested' | string }>(
			`/v1/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deploymentId)}/cancel`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	teamCapacity(teamId: string) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/teams/${encodeURIComponent(teamId)}/capacity`,
			{ requireAuth: true },
		);
	}

	teamCapacityProviders(teamId: string) {
		return this.request<{ ok: true; payload: unknown[] }>(
			`/v1/teams/${encodeURIComponent(teamId)}/capacity-providers`,
			{ requireAuth: true },
		);
	}

	launchManagedCapacityProvider(teamId: string, body: Record<string, unknown> = {}) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/teams/${encodeURIComponent(teamId)}/capacity/providers/managed`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	capacityProvider(providerId: string) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/capacity/providers/${encodeURIComponent(providerId)}`,
			{ requireAuth: true },
		);
	}

	rotateCapacityProviderApiKey(teamId: string, providerId: string) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/teams/${encodeURIComponent(teamId)}/capacity-providers/${encodeURIComponent(providerId)}/keys/rotate`,
			{ method: 'POST', requireAuth: true },
		);
	}

	capacityGrants(teamId: string) {
		return this.request<{ ok: true; payload: unknown[] }>(
			`/v1/teams/${encodeURIComponent(teamId)}/capacity-grants`,
			{ requireAuth: true },
		);
	}

	updateCapacityProvider(teamId: string, providerId: string, body: Record<string, unknown>) {
		return this.request<{ ok: true; provider: Record<string, unknown> }>(
			`/v1/teams/${encodeURIComponent(teamId)}/capacity-providers/${encodeURIComponent(providerId)}`,
			{ method: 'PATCH', body, requireAuth: true },
		);
	}

	createCapacityGrant(teamId: string, body: Record<string, unknown>) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/teams/${encodeURIComponent(teamId)}/capacity-grants`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	executionProviders(teamId: string, providerId: string) {
		return this.request<{ ok: true; payload: unknown[] }>(
			`/v1/teams/${encodeURIComponent(teamId)}/capacity-providers/${encodeURIComponent(providerId)}/execution-providers`,
			{ requireAuth: true },
		);
	}

	createExecutionProvider(teamId: string, providerId: string, body: Record<string, unknown>) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/teams/${encodeURIComponent(teamId)}/capacity-providers/${encodeURIComponent(providerId)}/execution-providers`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	updateExecutionProvider(teamId: string, providerId: string, executionProviderId: string, body: Record<string, unknown>) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/teams/${encodeURIComponent(teamId)}/capacity-providers/${encodeURIComponent(providerId)}/execution-providers/${encodeURIComponent(executionProviderId)}`,
			{ method: 'PATCH', body, requireAuth: true },
		);
	}

	createExecutionProviderNativeLimit(teamId: string, providerId: string, executionProviderId: string, body: Record<string, unknown>) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/teams/${encodeURIComponent(teamId)}/capacity-providers/${encodeURIComponent(providerId)}/execution-providers/${encodeURIComponent(executionProviderId)}/native-limits`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	capacityAllocationSets(teamId: string) {
		return this.request<{ ok: true; payload: unknown[] }>(
			`/v1/teams/${encodeURIComponent(teamId)}/capacity/allocation-sets`,
			{ requireAuth: true },
		);
	}

	createCapacityAllocationSet(teamId: string, body: Record<string, unknown>) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/teams/${encodeURIComponent(teamId)}/capacity/allocation-sets`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	capacityAllocationSet(teamId: string, allocationSetId: string) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/teams/${encodeURIComponent(teamId)}/capacity/allocation-sets/${encodeURIComponent(allocationSetId)}`,
			{ requireAuth: true },
		);
	}

	activateCapacityAllocationSet(teamId: string, allocationSetId: string) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/teams/${encodeURIComponent(teamId)}/capacity/allocation-sets/${encodeURIComponent(allocationSetId)}/activate`,
			{ method: 'POST', requireAuth: true },
		);
	}

	providerAvailabilitySessions(teamId: string, options: { providerId?: string | null; status?: string | null } = {}) {
		const params = new URLSearchParams();
		if (options.providerId) params.set('providerId', options.providerId);
		if (options.status) params.set('status', options.status);
		const query = params.toString() ? `?${params.toString()}` : '';
		return this.request<{ ok: true; payload: unknown[] }>(
			`/v1/teams/${encodeURIComponent(teamId)}/capacity/provider-sessions${query}`,
			{ requireAuth: true },
		);
	}

	providerAssignments(teamId: string, options: { projectId?: string | null; providerId?: string | null; status?: string | null } = {}) {
		const params = new URLSearchParams();
		if (options.projectId) params.set('projectId', options.projectId);
		if (options.providerId) params.set('providerId', options.providerId);
		if (options.status) params.set('status', options.status);
		const query = params.toString() ? `?${params.toString()}` : '';
		return this.request<{ ok: true; payload: unknown[] }>(
			`/v1/teams/${encodeURIComponent(teamId)}/capacity/assignments${query}`,
			{ requireAuth: true },
		);
	}

	createProviderAssignment(teamId: string, body: Record<string, unknown>) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/teams/${encodeURIComponent(teamId)}/capacity/assignments`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	providerAssignmentExplanation(teamId: string, assignmentId: string) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/teams/${encodeURIComponent(teamId)}/capacity/assignments/${encodeURIComponent(assignmentId)}/explanation`,
			{ requireAuth: true },
		);
	}

	projectCapacityPlan(projectId: string, environment?: string | null) {
		const query = environment ? `?environment=${encodeURIComponent(environment)}` : '';
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/projects/${encodeURIComponent(projectId)}/capacity-plan${query}`,
			{ requireAuth: true },
		);
	}

	projectAgentClasses(projectId: string) {
		return this.request<{ ok: true; payload: unknown[] }>(
			`/v1/projects/${encodeURIComponent(projectId)}/agent-classes`,
			{ requireAuth: true },
		);
	}

	createProjectAgentClass(projectId: string, body: Record<string, unknown>) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/projects/${encodeURIComponent(projectId)}/agent-classes`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	projectAgentClass(projectId: string, classId: string) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/projects/${encodeURIComponent(projectId)}/agent-classes/${encodeURIComponent(classId)}`,
			{ requireAuth: true },
		);
	}

	updateProjectAgentClass(projectId: string, classId: string, body: Record<string, unknown>) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/projects/${encodeURIComponent(projectId)}/agent-classes/${encodeURIComponent(classId)}`,
			{ method: 'PATCH', body, requireAuth: true },
		);
	}

	projectAgentModeRuns(projectId: string, options: { mode?: string | null; assignmentId?: string | null } = {}) {
		const params = new URLSearchParams();
		if (options.mode) params.set('mode', options.mode);
		if (options.assignmentId) params.set('assignmentId', options.assignmentId);
		const query = params.toString() ? `?${params.toString()}` : '';
		return this.request<{ ok: true; payload: unknown[] }>(
			`/v1/projects/${encodeURIComponent(projectId)}/agent-mode-runs${query}`,
			{ requireAuth: true },
		);
	}

	projectCapacityRuntimeDiagnostics(projectId: string, teamId: string) {
		const query = new URLSearchParams({ teamId });
		return this.request<{ ok: true; payload: unknown }>(
			`/v1/projects/${encodeURIComponent(projectId)}/capacity-runtime-diagnostics?${query.toString()}`,
			{ requireAuth: true },
		);
	}

	decisionPlanningStatus(decisionId: string) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/decisions/${encodeURIComponent(decisionId)}/planning-status`,
			{ requireAuth: true },
		);
	}

	createPlanningInputRequest(decisionId: string, body: Record<string, unknown>) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/decisions/${encodeURIComponent(decisionId)}/planning-input-requests`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	decisionExecutionInputs(decisionId: string, options: { status?: string | null } = {}) {
		const query = options.status ? `?status=${encodeURIComponent(options.status)}` : '';
		return this.request<{ ok: true; payload: unknown[] }>(
			`/v1/decisions/${encodeURIComponent(decisionId)}/execution-inputs${query}`,
			{ requireAuth: true },
		);
	}

	createDecisionExecutionInput(decisionId: string, body: Record<string, unknown>) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/decisions/${encodeURIComponent(decisionId)}/execution-inputs`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	acceptDecisionExecutionInput(inputId: string, body: Record<string, unknown> = {}) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/decision-execution-inputs/${encodeURIComponent(inputId)}/accept`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	requestDecisionExecutionInputRevision(inputId: string, body: Record<string, unknown> = {}) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/decision-execution-inputs/${encodeURIComponent(inputId)}/request-revision`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	decisionCapacityPlans(decisionId: string, options: { status?: string | null } = {}) {
		const query = options.status ? `?status=${encodeURIComponent(options.status)}` : '';
		return this.request<{ ok: true; payload: unknown[] }>(
			`/v1/decisions/${encodeURIComponent(decisionId)}/capacity-plans${query}`,
			{ requireAuth: true },
		);
	}

	createDecisionCapacityPlan(decisionId: string, body: Record<string, unknown>) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/decisions/${encodeURIComponent(decisionId)}/capacity-plans`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	capacityPlan(capacityPlanId: string) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/capacity-plans/${encodeURIComponent(capacityPlanId)}`,
			{ requireAuth: true },
		);
	}

	acceptCapacityPlan(capacityPlanId: string, body: Record<string, unknown> = {}) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/capacity-plans/${encodeURIComponent(capacityPlanId)}/accept`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	requestCapacityPlanRevision(capacityPlanId: string, body: Record<string, unknown> = {}) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/capacity-plans/${encodeURIComponent(capacityPlanId)}/request-revision`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	scheduleCapacityPlan(capacityPlanId: string, body: Record<string, unknown> = {}) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/capacity-plans/${encodeURIComponent(capacityPlanId)}/schedule`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	supersedeCapacityPlan(capacityPlanId: string, body: Record<string, unknown> = {}) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/capacity-plans/${encodeURIComponent(capacityPlanId)}/supersede`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	createWorkday(body: Record<string, unknown>) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			'/v1/workdays',
			{ method: 'POST', body, requireAuth: true },
		);
	}

	workday(workdayId: string) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/workdays/${encodeURIComponent(workdayId)}`,
			{ requireAuth: true },
		);
	}

	startWorkday(workdayId: string) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/workdays/${encodeURIComponent(workdayId)}/start`,
			{ method: 'POST', requireAuth: true },
		);
	}

	pauseWorkday(workdayId: string) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/workdays/${encodeURIComponent(workdayId)}/pause`,
			{ method: 'POST', requireAuth: true },
		);
	}

	completeWorkday(workdayId: string) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/workdays/${encodeURIComponent(workdayId)}/complete`,
			{ method: 'POST', requireAuth: true },
		);
	}

	workdaySummary(workdayId: string) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/workdays/${encodeURIComponent(workdayId)}/summary`,
			{ requireAuth: true },
		);
	}

	workdayRuns(teamId: string, options: { status?: string | null; providerId?: string | null } = {}) {
		const params = new URLSearchParams();
		if (options.status) params.set('status', options.status);
		if (options.providerId) params.set('providerId', options.providerId);
		const query = params.toString() ? `?${params.toString()}` : '';
		return this.request<{ ok: true; payload: unknown[] }>(
			`/v1/teams/${encodeURIComponent(teamId)}/workday-runs${query}`,
			{ requireAuth: true },
		);
	}

	createWorkdayRun(teamId: string, body: Record<string, unknown>) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/teams/${encodeURIComponent(teamId)}/workday-runs`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	workdayRun(teamId: string, runId: string) {
		return this.request<{ ok: true; payload: { run: Record<string, unknown>; events: unknown[] } }>(
			`/v1/teams/${encodeURIComponent(teamId)}/workday-runs/${encodeURIComponent(runId)}`,
			{ requireAuth: true },
		);
	}

	updateWorkdayRun(teamId: string, runId: string, body: Record<string, unknown>) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/teams/${encodeURIComponent(teamId)}/workday-runs/${encodeURIComponent(runId)}`,
			{ method: 'PATCH', body, requireAuth: true },
		);
	}

	workdayEvents(teamId: string, runId: string) {
		return this.request<{ ok: true; payload: unknown[] }>(
			`/v1/teams/${encodeURIComponent(teamId)}/workday-runs/${encodeURIComponent(runId)}/events`,
			{ requireAuth: true },
		);
	}

	createWorkdayEvent(teamId: string, runId: string, body: Record<string, unknown>) {
		return this.request<{ ok: true; payload: Record<string, unknown> }>(
			`/v1/teams/${encodeURIComponent(teamId)}/workday-runs/${encodeURIComponent(runId)}/events`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	planSeed(seedName: string, body: Record<string, unknown>) {
		return this.request<Record<string, unknown>>(
			`/v1/seeds/${encodeURIComponent(seedName)}/plan`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	applySeed(seedName: string, body: Record<string, unknown>) {
		return this.request<Record<string, unknown>>(
			`/v1/seeds/${encodeURIComponent(seedName)}/apply`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	listSeedRuns(limit?: number) {
		const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : '';
		return this.request<{ ok: true; payload: unknown[] }>(`/v1/seeds/runs${query}`, { requireAuth: true });
	}

	exportSeed(teamId: string, body: Record<string, unknown>) {
		return this.request<Record<string, unknown>>(
			`/v1/teams/${encodeURIComponent(teamId)}/seeds/export`,
			{ method: 'POST', body, requireAuth: true },
		);
	}

	catalog(kind?: string | null) {
		const query = kind ? `?kind=${encodeURIComponent(kind)}` : '';
		return this.request<{ ok: true; payload: unknown[] }>(`/v1/catalog${query}`, { requireAuth: Boolean(this.accessToken) });
	}

	artifactDownload(itemId: string, version: string) {
		return this.request<{ ok: true; payload: CatalogArtifactDownload }>(
			`/v1/catalog/${encodeURIComponent(itemId)}/artifacts/${encodeURIComponent(version)}/download`,
			{ requireAuth: Boolean(this.accessToken) },
		);
	}
}

export async function listIntegratedMarketCatalog<T extends Record<string, unknown> = Record<string, unknown>>({
	kind,
	selector,
	authRoot,
	fetchImpl,
	userAgent,
}: {
	kind?: string | null;
	selector?: string | null;
	authRoot?: string | null;
	fetchImpl?: typeof fetch;
	userAgent?: string;
}): Promise<IntegratedMarketCatalogResult<T>> {
	const payload: Array<MarketSourcedCatalogItem<T>> = [];
	const errors: IntegratedMarketCatalogResult<T>['errors'] = [];
	for (const profile of resolveCatalogMarketProfiles(selector)) {
		const session = authRoot ? resolveMarketSession(authRoot, profile.id) : null;
		const client = new MarketClient({
			profile,
			accessToken: session?.accessToken ?? null,
			fetchImpl,
			userAgent,
		});
		try {
			const response = await client.catalog(kind);
			for (const item of response.payload as T[]) {
				payload.push({
					...item,
					sourceMarket: profileToSource(profile),
				});
			}
		} catch (error) {
			errors.push({
				market: profileToSource(profile),
				status: error instanceof MarketClientError ? error.status : undefined,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return { ok: true, payload, errors };
}

export async function resolveIntegratedCatalogArtifactDownload({
	itemId,
	version,
	selector,
	authRoot,
	fetchImpl,
	userAgent,
}: {
	itemId: string;
	version: string;
	selector?: string | null;
	authRoot?: string | null;
	fetchImpl?: typeof fetch;
	userAgent?: string;
}): Promise<{ ok: true; payload: MarketSourcedCatalogArtifactDownload }> {
	const errors: string[] = [];
	for (const profile of resolveCatalogMarketProfiles(selector)) {
		const session = authRoot ? resolveMarketSession(authRoot, profile.id) : null;
		const client = new MarketClient({
			profile,
			accessToken: session?.accessToken ?? null,
			fetchImpl,
			userAgent,
		});
		try {
			const response = await client.artifactDownload(itemId, version);
			return {
				ok: true,
				payload: {
					...response.payload,
					sourceMarket: profileToSource(profile),
				},
			};
		} catch (error) {
			if (error instanceof MarketClientError && error.status === 404) {
				continue;
			}
			errors.push(`${profile.id}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	const suffix = errors.length > 0 ? ` Errors: ${errors.join('; ')}` : '';
	throw new Error(`Catalog artifact "${itemId}" version "${version}" was not found in the selected market catalogs.${suffix}`);
}

export async function verifyArtifactBytes(response: Response, expectedSha256?: string | null) {
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (expectedSha256) {
		const actual = createHash('sha256').update(bytes).digest('hex');
		if (actual !== expectedSha256) {
			throw new Error(`Artifact checksum mismatch. Expected ${expectedSha256}, received ${actual}.`);
		}
	}
	return bytes;
}
