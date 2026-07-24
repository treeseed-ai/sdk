import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { ApiPrincipal, DeviceCodePollRequest, DeviceCodePollResponse, DeviceCodeStartRequest, DeviceCodeStartResponse, TokenRefreshRequest, TokenRefreshResponse, } from "../../../entrypoints/clients/remote.ts";
import type { CreateProjectWebDeploymentRequest, CreateProjectWebDeploymentResponse, ProjectDeployment, ProjectDeploymentActionAvailability, ProjectDeploymentEnvironment, ProjectDeploymentEvent, ProjectDeploymentReadiness, ProjectConnection, ProjectRepositoryTopology, ProjectWebDeploymentAction, TreeDxInstance, TreeDxMirror, TreeDxProjectLibraryBinding, TreeDxShareLink, } from "../../../entrypoints/models/sdk-types.ts";
import type { GitHubActionsEncryptedSecretDeployment, GitHubActionsSecretPublicKeyMetadata, } from "../../../configuration/secrets-capability.ts";
import type { RepositoryImportPlan } from "../../../projects/projects-core/project-import.ts";
import type { CapacityRuntimeDiagnosticsResponse, WorkdayCapacitySummaryPayload } from "../../../capacity/agents/agent-capacity.ts";
import type { AccountDeletionBlocker, AccountIdentity, AccountNotification, AccountWebSession, AuthAvailabilityResult, NotificationPreferences, PersonalTheme, PersonalThemeDraft, } from "../../../accounts/account-contracts.ts";
import type { ProviderRegistrationRequest, ProviderCredentialIssuanceAuthorization, ProviderTeamCredentialMetadata, ProviderTeamMembership, TeamCapacityRegistrationKeyMetadata, TeamCapacityRegistrationKeyReveal, } from "../../../capacity-provider/contracts/index.ts";
import type { CapacityPage } from "../../../capacity/capacity-core/capacity-pagination.ts";
import { REMOTE_CONTRACT_HEADER, REMOTE_CONTRACT_VERSION, } from "../../../entrypoints/clients/remote.ts";
import { resolveRemoteSession, setRemoteSession, clearRemoteSession, } from "../../../operations/services/configuration/config-runtime.ts";
import { DEFAULT_MARKET_BASE_URL, CENTRAL_MARKET_API_BASE_URL_ENV, API_BASE_URL_ENV, CATALOG_MARKET_API_BASE_URLS_ENV, MarketProfileKind, MarketProfile, MarketSession, MarketWebAuthSession, MarketUserEmailAddress, MarketRegistryState, TeamAccessSummary, ProjectEnvironmentAccess, CatalogArtifactDownload, MarketCatalogSource, MarketSourcedCatalogItem, MarketSourcedCatalogArtifactDownload, IntegratedMarketCatalogResult, MarketProjectDeploymentState, ProjectDeploymentListFilters, MarketClientOptions, MARKET_REGISTRY_RELATIVE_PATH, envValue, resolveDefaultCentralMarketBaseUrl, defaultCentralMarket, defaultLocalMarket, homeConfigPath, normalizeBaseUrl, normalizeProfile, uniqueProfiles, loadMarketRegistryState, writeMarketRegistryState, addMarketProfile, removeMarketProfile, setActiveMarketProfile, resolveMarketProfile, resolveMarketSession, setMarketSession, clearMarketSession, profileToSource, catalogProfileIdForUrl, parseCatalogMarketBaseUrls, resolveCatalogMarketProfiles, MarketClientError, MarketClient, listIntegratedMarketCatalog, resolveIntegratedCatalogArtifactDownload, verifyArtifactBytes } from "../../../entrypoints/clients/market-client.ts";
export async function requestMethod<T>(this: MarketClient, path: string, options: {
    method?: string;
    body?: unknown;
    requireAuth?: boolean;
    headers?: Record<string, string>;
} = {}): Promise<T> {
    const headers: Record<string, string> = {
        accept: 'application/json',
        [REMOTE_CONTRACT_HEADER]: String(REMOTE_CONTRACT_VERSION),
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
        const responsePayload = payload && typeof payload === 'object'
            ? payload as {
                error?: unknown;
                message?: unknown;
                details?: unknown;
            }
            : {};
        const payloadError = responsePayload.error;
        const baseError = typeof payloadError === 'string'
            ? String(payloadError)
            : payloadError && typeof payloadError === 'object' && typeof (payloadError as {
                message?: unknown;
            }).message === 'string'
                ? String((payloadError as {
                    message: string;
                }).message)
                : typeof responsePayload.message === 'string'
                    ? responsePayload.message
                    : `Market request failed with ${response.status}.`;
        const operation = responsePayload && 'details' in responsePayload
            && responsePayload.details && typeof responsePayload.details === 'object'
            && typeof (responsePayload.details as {
                operation?: unknown;
            }).operation === 'string'
            ? (responsePayload.details as {
                operation: string;
            }).operation
            : null;
        const error = operation ? `${baseError} (operation: ${operation})` : baseError;
        throw new MarketClientError(error, response.status, payload);
    }
    return payload as T;
}
