import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { ApiPrincipal, DeviceCodePollRequest, DeviceCodePollResponse, DeviceCodeStartRequest, DeviceCodeStartResponse, TokenRefreshRequest, TokenRefreshResponse, } from './remote.ts';
import type { CreateProjectWebDeploymentRequest, CreateProjectWebDeploymentResponse, ProjectDeployment, ProjectDeploymentActionAvailability, ProjectDeploymentEnvironment, ProjectDeploymentEvent, ProjectDeploymentReadiness, ProjectConnection, ProjectRepositoryTopology, ProjectWebDeploymentAction, TreeDxInstance, TreeDxMirror, TreeDxProjectLibraryBinding, TreeDxShareLink, } from './sdk-types.ts';
import type { TreeseedGitHubActionsEncryptedSecretDeployment, TreeseedGitHubActionsSecretPublicKeyMetadata, } from './secrets-capability.ts';
import type { TreeseedRepositoryImportPlan } from './project-import.ts';
import type { CapacityRuntimeDiagnosticsResponse, WorkdayCapacitySummaryPayload } from './agent-capacity.ts';
import type { AccountDeletionBlocker, AccountIdentity, AccountNotification, AccountWebSession, AuthAvailabilityResult, NotificationPreferences, PersonalTheme, PersonalThemeDraft, } from './account-contracts.ts';
import type { ProviderRegistrationRequest, ProviderCredentialIssuanceAuthorization, ProviderTeamCredentialMetadata, ProviderTeamMembership, TeamCapacityRegistrationKeyMetadata, TeamCapacityRegistrationKeyReveal, } from './capacity-provider/contracts/index.ts';
import type { CapacityPage } from './capacity-pagination.ts';
import { TREESEED_REMOTE_CONTRACT_HEADER, TREESEED_REMOTE_CONTRACT_VERSION, } from './remote.ts';
import { resolveTreeseedRemoteSession, setTreeseedRemoteSession, clearTreeseedRemoteSession, } from './operations/services/config-runtime.ts';
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
export const MARKET_REGISTRY_RELATIVE_PATH = '.treeseed/config/markets.json';
export function envValue(name: string, env: Record<string, string | undefined> = process.env) {
    return typeof env[name] === 'string' && env[name]!.trim().length > 0 ? env[name]!.trim() : null;
}
export function resolveDefaultCentralMarketBaseUrl(env: Record<string, string | undefined> = process.env) {
    return normalizeBaseUrl(envValue(TREESEED_CENTRAL_MARKET_API_BASE_URL_ENV, env)
        ?? DEFAULT_TREESEED_MARKET_BASE_URL);
}
export function defaultCentralMarket(): MarketProfile {
    return {
        id: 'central',
        label: 'TreeSeed Central Market',
        baseUrl: resolveDefaultCentralMarketBaseUrl(),
        kind: 'central',
        alwaysAvailable: true,
    };
}
export function defaultLocalMarket(env: Record<string, string | undefined> = process.env): MarketProfile {
    return {
        id: 'local',
        label: 'Local TreeSeed Market',
        baseUrl: normalizeBaseUrl(envValue(TREESEED_API_BASE_URL_ENV, env)
            ?? 'http://127.0.0.1:3000'),
        kind: 'specialized',
        alwaysAvailable: true,
    };
}
export function homeConfigPath() {
    const homeRoot = process.env.HOME && process.env.HOME.trim().length > 0 ? process.env.HOME : homedir();
    return resolve(homeRoot, MARKET_REGISTRY_RELATIVE_PATH);
}
export function normalizeBaseUrl(baseUrl: string) {
    return baseUrl.trim().replace(/\/+$/u, '');
}
export function normalizeProfile(profile: MarketProfile): MarketProfile {
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
export function uniqueProfiles(profiles: MarketProfile[]) {
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
        if (left.id === 'central')
            return -1;
        if (right.id === 'central')
            return 1;
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
    }
    catch {
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
export function profileToSource(profile: MarketProfile): MarketCatalogSource {
    return {
        id: profile.id,
        label: profile.label,
        baseUrl: profile.baseUrl,
        kind: profile.kind,
        teamId: profile.teamId ?? null,
    };
}
export function catalogProfileIdForUrl(baseUrl: string) {
    const id = normalizeBaseUrl(baseUrl)
        .replace(/^https?:\/\//iu, '')
        .replace(/[^A-Za-z0-9._-]+/gu, '-')
        .replace(/^-+|-+$/gu, '');
    return id ? `catalog-${id}` : 'catalog-market';
}
export function parseCatalogMarketBaseUrls(env: Record<string, string | undefined> = process.env) {
    const raw = envValue(TREESEED_CATALOG_MARKET_API_BASE_URLS_ENV, env);
    if (!raw)
        return [];
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
        if (left.id === 'central')
            return -1;
        if (right.id === 'central')
            return 1;
        return left.id.localeCompare(right.id);
    });
}
export class MarketClientError extends Error {
    constructor(message: string, readonly status: number, readonly payload: unknown) {
        super(message);
        this.name = 'MarketClientError';
    }
}
import * as extractedMethods from "./market-client/methods.ts";
import "./market-client/interface.ts";
export class MarketClient {
    readonly baseUrl: string;
    readonly accessToken: string | null;
    readonly fetchImpl: typeof fetch;
    readonly userAgent?: string;
    constructor(readonly options: MarketClientOptions) {
        this.baseUrl = normalizeBaseUrl(options.profile.baseUrl);
        this.accessToken = options.accessToken ?? null;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.userAgent = options.userAgent;
    }
}
extractedMethods.installMarketClientMethods(MarketClient.prototype);
export async function listIntegratedMarketCatalog<T extends Record<string, unknown> = Record<string, unknown>>({ kind, selector, authRoot, fetchImpl, userAgent, }: {
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
        }
        catch (error) {
            errors.push({
                market: profileToSource(profile),
                status: error instanceof MarketClientError ? error.status : undefined,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return { ok: true, payload, errors };
}
export async function resolveIntegratedCatalogArtifactDownload({ itemId, version, selector, authRoot, fetchImpl, userAgent, }: {
    itemId: string;
    version: string;
    selector?: string | null;
    authRoot?: string | null;
    fetchImpl?: typeof fetch;
    userAgent?: string;
}): Promise<{
    ok: true;
    payload: MarketSourcedCatalogArtifactDownload;
}> {
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
        }
        catch (error) {
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
