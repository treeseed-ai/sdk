export {
compileDesiredResourceGraph,
compileDesiredUnitsFromGraph,
convertDesiredResourceToReconcileUnit,
selectDesiredResources,
type DesiredEnvironment,
type DesiredResource,
type DesiredResourceEdge,
type DesiredResourceGraph,
type DesiredResourceKind,
type PackageUnit
} from '../platform/reconciliation/desired-state.ts';

export {
loadPlatformConfig,
type PlatformConfigInput
} from '../platform/configuration/config.ts';

export {
githubRepositoryCredentialEnvName,
resolveGitHubCredentialForRepository,
type GitHubCredentialResolution
} from '../operations/services/configuration/github-credentials.ts';

export {
deployRailwayServiceInstance,ensureRailwayEnvironment,ensureRailwayGeneratedServiceDomain,ensureRailwayProject,
ensureRailwayService,
ensureRailwayServiceInstanceConfiguration,
ensureRailwayServiceVolume,
getRailwayAuthProfile,
listRailwayEnvironments,
listRailwayProjects,
listRailwayServiceDomains,
listRailwayServices,
listRailwayVariables,
normalizeRailwayEnvironmentName,
resolveRailwayApiToken,
resolveRailwayApiUrl,
resolveRailwayWorkspace,
resolveRailwayWorkspaceContext,
upsertRailwayVariables
} from '../operations/services/hosting/railway/railway-api.ts';

export {
buildTemplateMarketPackage
} from '../operations/services/support/market-packaging.ts';

export {
collectDependencyStatus,
collectToolStatus,
createManagedToolEnv,
formatDependencyReport,
installDependencies,
resolveToolBinary,
resolveToolCommand,
type ToolStatusResult
} from '../entrypoints/runtime/managed-dependencies.ts';

export * from '../configuration/service-credentials.ts';

export {
API_BASE_URL_ENV,CATALOG_MARKET_API_BASE_URLS_ENV,
MARKET_API_BASE_URL_ENV,DEFAULT_MARKET_BASE_URL,MarketClient,
MarketClientError,addMarketProfile,
clearMarketSession,
listIntegratedMarketCatalog,
loadMarketRegistryState,
removeMarketProfile,
resolveCatalogMarketProfiles,
resolveDefaultCentralMarketBaseUrl,
resolveIntegratedCatalogArtifactDownload,
resolveMarketProfile,
resolveMarketSession,
setActiveMarketProfile,
setMarketSession,
verifyArtifactBytes,
writeMarketRegistryState
} from '../entrypoints/clients/market-client.ts';
