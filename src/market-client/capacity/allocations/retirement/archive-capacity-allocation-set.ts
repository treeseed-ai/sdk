import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { ApiPrincipal, DeviceCodePollRequest, DeviceCodePollResponse, DeviceCodeStartRequest, DeviceCodeStartResponse, TokenRefreshRequest, TokenRefreshResponse, } from "../../../../entrypoints/clients/remote.ts";
import type { CreateProjectWebDeploymentRequest, CreateProjectWebDeploymentResponse, ProjectDeployment, ProjectDeploymentActionAvailability, ProjectDeploymentEnvironment, ProjectDeploymentEvent, ProjectDeploymentReadiness, ProjectConnection, ProjectRepositoryTopology, ProjectWebDeploymentAction, TreeDxInstance, TreeDxMirror, TreeDxProjectLibraryBinding, TreeDxShareLink, } from "../../../../entrypoints/models/sdk-types.ts";
import type { GitHubActionsEncryptedSecretDeployment, GitHubActionsSecretPublicKeyMetadata, } from "../../../../configuration/secrets-capability.ts";
import type { RepositoryImportPlan } from "../../../../projects/projects-core/project-import.ts";
import type { CapacityRuntimeDiagnosticsResponse, WorkdayCapacitySummaryPayload } from "../../../../capacity/agents/agent-capacity.ts";
import type { AccountDeletionBlocker, AccountIdentity, AccountNotification, AccountWebSession, AuthAvailabilityResult, NotificationPreferences, PersonalTheme, PersonalThemeDraft, } from "../../../../accounts/account-contracts.ts";
import type { ProviderRegistrationRequest, ProviderCredentialIssuanceAuthorization, ProviderTeamCredentialMetadata, ProviderTeamMembership, TeamCapacityRegistrationKeyMetadata, TeamCapacityRegistrationKeyReveal, } from "../../../../capacity-provider/contracts/index.ts";
import type { CapacityPage } from "../../../../capacity/capacity-core/capacity-pagination.ts";
import { REMOTE_CONTRACT_HEADER, REMOTE_CONTRACT_VERSION, } from "../../../../entrypoints/clients/remote.ts";
import { resolveRemoteSession, setRemoteSession, clearRemoteSession, } from "../../../../operations/services/configuration/config-runtime.ts";
import { DEFAULT_MARKET_BASE_URL, CENTRAL_MARKET_API_BASE_URL_ENV, API_BASE_URL_ENV, CATALOG_MARKET_API_BASE_URLS_ENV, MarketProfileKind, MarketProfile, MarketSession, MarketWebAuthSession, MarketUserEmailAddress, MarketRegistryState, TeamAccessSummary, ProjectEnvironmentAccess, CatalogArtifactDownload, MarketCatalogSource, MarketSourcedCatalogItem, MarketSourcedCatalogArtifactDownload, IntegratedMarketCatalogResult, MarketProjectDeploymentState, ProjectDeploymentListFilters, MarketClientOptions, MARKET_REGISTRY_RELATIVE_PATH, envValue, resolveDefaultCentralMarketBaseUrl, defaultCentralMarket, defaultLocalMarket, homeConfigPath, normalizeBaseUrl, normalizeProfile, uniqueProfiles, loadMarketRegistryState, writeMarketRegistryState, addMarketProfile, removeMarketProfile, setActiveMarketProfile, resolveMarketProfile, resolveMarketSession, setMarketSession, clearMarketSession, profileToSource, catalogProfileIdForUrl, parseCatalogMarketBaseUrls, resolveCatalogMarketProfiles, MarketClientError, MarketClient, listIntegratedMarketCatalog, resolveIntegratedCatalogArtifactDownload, verifyArtifactBytes } from "../../../../entrypoints/clients/market-client.ts";
export function archiveCapacityAllocationSetMethod(this: MarketClient, teamId: string, allocationSetId: string, idempotencyKey: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity/allocation-sets/${encodeURIComponent(allocationSetId)}/archive`, { method: 'POST', requireAuth: true, headers: { 'idempotency-key': idempotencyKey } });
}
