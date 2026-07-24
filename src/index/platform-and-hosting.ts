export {
	compileTreeseedDesiredResourceGraph,
	compileTreeseedDesiredUnitsFromGraph,
	convertDesiredResourceToReconcileUnit,
	selectTreeseedDesiredResources,
	type TreeseedDesiredEnvironment,
	type TreeseedDesiredResource,
	type TreeseedDesiredResourceEdge,
	type TreeseedDesiredResourceGraph,
	type TreeseedDesiredResourceKind,
	type TreeseedPackageUnit,
} from '.././platform/desired-state.ts';

export {
	loadTreeseedPlatformConfig,
	type TreeseedPlatformConfigInput,
} from '.././platform/config.ts';

export {
	githubRepositoryCredentialEnvName,
	resolveGitHubCredentialForRepository,
	type TreeseedGitHubCredentialResolution,
} from '.././operations/services/github-credentials.ts';

export {
	executeKnowledgeHubProviderLaunch,
	validateKnowledgeHubProviderLaunchPrerequisites,
} from '.././operations/services/hub-provider-launch.ts';

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
} from '.././operations/services/hub-launch.ts';

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
} from '.././operations/services/railway-api.ts';

export {
	buildKnowledgePackMarketPackage,
	buildTemplateMarketPackage,
	importKnowledgePack,
} from '.././operations/services/market-packaging.ts';

export {
	collectTreeseedDependencyStatus,
	collectTreeseedToolStatus,
	createTreeseedManagedToolEnv,
	formatTreeseedDependencyReport,
	installTreeseedDependencies,
	resolveTreeseedToolBinary,
	resolveTreeseedToolCommand,
	type TreeseedToolStatusResult,
} from '.././managed-dependencies.ts';

export * from '.././service-credentials.ts';

export {
	deriveProjectHostBindingsView,
	executeProjectHostBindingOperation,
	planProjectHostBindingOperation,
} from '.././operations/services/project-host-operations.ts';

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
} from '.././operations/services/project-host-operations.ts';

export {
	MarketClient,
	MarketClientError,
	DEFAULT_TREESEED_MARKET_BASE_URL,
	TREESEED_CATALOG_MARKET_API_BASE_URLS_ENV,
	TREESEED_CENTRAL_MARKET_API_BASE_URL_ENV,
	TREESEED_API_BASE_URL_ENV,
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
} from '.././market-client.ts';
