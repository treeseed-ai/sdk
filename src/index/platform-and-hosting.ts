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
	CONTROL_PLANE_BASE_URL_ENV,
	CONTROL_PLANE_SERVER_REGISTRY_PATH,
	ControlPlaneClient,
	ControlPlaneClientError,
	clearControlPlaneServerSession,
	defaultLocalControlPlaneServer,
	loadControlPlaneServerRegistry,
	resolveControlPlaneServer,
	resolveControlPlaneServerSession,
	setControlPlaneServerSession,
	writeControlPlaneServerRegistry,
} from '../entrypoints/clients/control-plane-client.ts';
