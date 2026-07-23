import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { ApiPrincipal, DeviceCodePollRequest, DeviceCodePollResponse, DeviceCodeStartRequest, DeviceCodeStartResponse, TokenRefreshRequest, TokenRefreshResponse, } from ".././remote.ts";
import type { CreateProjectWebDeploymentRequest, CreateProjectWebDeploymentResponse, ProjectDeployment, ProjectDeploymentActionAvailability, ProjectDeploymentEnvironment, ProjectDeploymentEvent, ProjectDeploymentReadiness, ProjectConnection, ProjectRepositoryTopology, ProjectWebDeploymentAction, TreeDxInstance, TreeDxMirror, TreeDxProjectLibraryBinding, TreeDxShareLink, } from ".././sdk-types.ts";
import type { TreeseedGitHubActionsEncryptedSecretDeployment, TreeseedGitHubActionsSecretPublicKeyMetadata, } from ".././secrets-capability.ts";
import type { TreeseedRepositoryImportPlan } from ".././project-import.ts";
import type { CapacityRuntimeDiagnosticsResponse, WorkdayCapacitySummaryPayload } from ".././agent-capacity.ts";
import type { AccountDeletionBlocker, AccountIdentity, AccountNotification, AccountWebSession, AuthAvailabilityResult, NotificationPreferences, PersonalTheme, PersonalThemeDraft, } from ".././account-contracts.ts";
import type { ProviderRegistrationRequest, ProviderCredentialIssuanceAuthorization, ProviderTeamCredentialMetadata, ProviderTeamMembership, TeamCapacityRegistrationKeyMetadata, TeamCapacityRegistrationKeyReveal, } from ".././capacity-provider/contracts/index.ts";
import type { CapacityPage } from ".././capacity-pagination.ts";
import { TREESEED_REMOTE_CONTRACT_HEADER, TREESEED_REMOTE_CONTRACT_VERSION, } from ".././remote.ts";
import { resolveTreeseedRemoteSession, setTreeseedRemoteSession, clearTreeseedRemoteSession, } from ".././operations/services/config-runtime.ts";
import { DEFAULT_TREESEED_MARKET_BASE_URL, TREESEED_CENTRAL_MARKET_API_BASE_URL_ENV, TREESEED_API_BASE_URL_ENV, TREESEED_CATALOG_MARKET_API_BASE_URLS_ENV, MarketProfileKind, MarketProfile, MarketSession, MarketWebAuthSession, MarketUserEmailAddress, MarketRegistryState, TeamAccessSummary, ProjectEnvironmentAccess, CatalogArtifactDownload, MarketCatalogSource, MarketSourcedCatalogItem, MarketSourcedCatalogArtifactDownload, IntegratedMarketCatalogResult, MarketProjectDeploymentState, ProjectDeploymentListFilters, MarketClientOptions, MARKET_REGISTRY_RELATIVE_PATH, envValue, resolveDefaultCentralMarketBaseUrl, defaultCentralMarket, defaultLocalMarket, homeConfigPath, normalizeBaseUrl, normalizeProfile, uniqueProfiles, loadMarketRegistryState, writeMarketRegistryState, addMarketProfile, removeMarketProfile, setActiveMarketProfile, resolveMarketProfile, resolveMarketSession, setMarketSession, clearMarketSession, profileToSource, catalogProfileIdForUrl, parseCatalogMarketBaseUrls, resolveCatalogMarketProfiles, MarketClientError, MarketClient, listIntegratedMarketCatalog, resolveIntegratedCatalogArtifactDownload, verifyArtifactBytes } from "../market-client.ts";
export function capacityProviderAssignmentsMethod(this: MarketClient, teamId: string, options: {
    projectId?: string | null;
    providerId?: string | null;
    status?: string | null;
    assignmentId?: string | null;
    workdayId?: string | null;
    executionProviderId?: string | null;
    view?: 'lifecycle' | null;
    limit?: number;
    cursor?: string | null;
} = {}) {
    const params = new URLSearchParams();
    if (options.projectId)
        params.set('projectId', options.projectId);
    if (options.providerId)
        params.set('providerId', options.providerId);
    if (options.status)
        params.set('status', options.status);
    if (options.assignmentId)
        params.set('assignmentId', options.assignmentId);
    if (options.workdayId)
        params.set('workdayId', options.workdayId);
    if (options.executionProviderId)
        params.set('executionProviderId', options.executionProviderId);
    if (options.view)
        params.set('view', options.view);
    if (options.limit !== undefined)
        params.set('limit', String(options.limit));
    if (options.cursor)
        params.set('cursor', options.cursor);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<{
        ok: true;
        payload: {
            items: unknown[];
            page: {
                limit: number;
                hasMore: boolean;
                nextCursor: string | null;
            };
        };
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity/assignments${query}`, { requireAuth: true });
}
