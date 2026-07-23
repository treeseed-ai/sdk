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
export async function requestFirstMethod<T>(this: MarketClient, paths: string[], options: {
    method?: string;
    body?: unknown;
    requireAuth?: boolean;
    headers?: Record<string, string>;
} = {}): Promise<T> {
    let notFound: MarketClientError | null = null;
    for (const path of paths) {
        try {
            return await this.request<T>(path, options);
        }
        catch (error) {
            if (error instanceof MarketClientError && error.status === 404) {
                notFound = error;
                continue;
            }
            throw error;
        }
    }
    throw notFound ?? new MarketClientError('Market request failed with 404.', 404, {});
}
