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
	type PackageUnit,
} from '../platform/reconciliation/desired-state.ts';

export {
	loadPlatformConfig,
	type PlatformConfigInput,
} from '../platform/configuration/config.ts';

export {
	githubRepositoryCredentialEnvName,
	resolveGitHubCredentialForRepository,
	type GitHubCredentialResolution,
} from '../operations/services/configuration/github-credentials.ts';

export {
	executeKnowledgeHubProviderLaunch,
	validateKnowledgeHubProviderLaunchPrerequisites,
} from '../operations/services/capacity/providers/hub-provider-launch.ts';

export {
	createKnowledgeHubRepositories,
	defaultHubContentResolutionPolicy,
	executeKnowledgeHubLaunch,
	normalizeKnowledgeHubLaunchIntent,
	planKnowledgeHubLaunch,
	planKnowledgeHubRepositories,
	validateRepositoryHost,
	type HubContentResolutionPolicy,
	type KnowledgeHubLaunchIntent,
	type KnowledgeHubLaunchPhase,
	type KnowledgeHubLaunchPlan,
	type KnowledgeHubLaunchResult,
	type KnowledgeHubRepositoryPlan,
	type RepositoryHost,
} from '../operations/services/support/hub-launch.ts';

export {
	deployRailwayServiceInstance,
	ensureRailwayGeneratedServiceDomain,
	ensureRailwayEnvironment,
	ensureRailwayProject,
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
	upsertRailwayVariables,
} from '../operations/services/hosting/railway/railway-api.ts';

export {
	buildKnowledgePackMarketPackage,
	buildTemplateMarketPackage,
	importKnowledgePack,
} from '../operations/services/support/market-packaging.ts';

export {
	collectDependencyStatus,
	collectToolStatus,
	createManagedToolEnv,
	formatDependencyReport,
	installDependencies,
	resolveToolBinary,
	resolveToolCommand,
	type ToolStatusResult,
} from '../entrypoints/runtime/managed-dependencies.ts';

export * from '../configuration/service-credentials.ts';

export {
	deriveProjectHostBindingsView,
	executeProjectHostBindingOperation,
	planProjectHostBindingOperation,
} from '../operations/services/projects/hosting/project-host-operations.ts';

export type {
	ExecuteProjectHostBindingOperationContext,
	ExecuteProjectHostBindingOperationInput,
	ExecuteProjectHostBindingOperationResult,
	PlanProjectHostBindingOperationOptions,
	PlanProjectHostBindingOperationResult,
	ProjectHostBindingsView,
	ProjectHostOperationDiagnostic,
	ProjectHostOperationKind,
	ProjectHostOperationStatus,
	ProjectHostRequirementBindingView,
} from '../operations/services/projects/hosting/project-host-operations.ts';

export {
	MarketClient,
	MarketClientError,
	DEFAULT_MARKET_BASE_URL,
	CATALOG_MARKET_API_BASE_URLS_ENV,
	CENTRAL_MARKET_API_BASE_URL_ENV,
	API_BASE_URL_ENV,
	addMarketProfile,
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
	writeMarketRegistryState,
} from '../entrypoints/clients/market-client.ts';
