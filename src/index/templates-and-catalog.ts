export { RemoteTemplateCatalogClient, parseTemplateCatalogResponse } from '../commerce/catalog/template-catalog.ts';

export {
	normalizeProjectLaunchHostBindings,
	normalizeTemplateLaunchRequirements,
	parseProjectLaunchHostBindingSpecs,
	resolveProjectLaunchHostBindings,
	validateTemplateLaunchRequirements,
} from '../entrypoints/templates/template-launch-requirements.ts';

export type {
	ParseProjectLaunchHostBindingSpecsOptions,
	ParseProjectLaunchHostBindingSpecsResult,
	ProjectLaunchConfigWritePlanItem,
	ProjectLaunchHostInventoryRecord,
	ProjectLaunchLocalHostBindingSummary,
	ProjectLaunchResolvedHostBinding,
	ProjectLaunchSecretDeploymentPlanItem,
	ResolveProjectLaunchHostBindingsOptions,
	ResolveProjectLaunchHostBindingsResult,
} from '../entrypoints/templates/template-launch-requirements.ts';

export {
	deriveProjectLaunchRequirementsViewModel,
} from '../entrypoints/templates/template-launch-ui.ts';

export type {
	DeriveProjectLaunchRequirementsViewModelOptions,
	ProjectLaunchHostRequirementViewModel,
	ProjectLaunchRequirementHostChoice,
	ProjectLaunchRequirementsViewModel,
	ProjectLaunchResourceRequirementViewModel,
	ProjectLaunchSecretRequirementViewModel,
} from '../entrypoints/templates/template-launch-ui.ts';

export {
	applyProjectLaunchHostBindingConfig,
	auditProjectLaunchHostBindingConfig,
	preserveProjectLaunchHostBindingConfigOverlay,
} from '../operations/services/hosting/deployment/template-host-bindings.ts';

export type {
	ApplyProjectLaunchHostBindingConfigOptions,
	ProjectLaunchHostBindingConfigAuditDiagnostic,
	ProjectLaunchHostBindingConfigAuditResult,
	ProjectLaunchHostBindingConfigApplyResult,
	ProjectLaunchHostBindingConfigWriteSummary,
	ProjectLaunchHostBindingEnvironmentWriteSummary,
} from '../operations/services/hosting/deployment/template-host-bindings.ts';

export {
	ProjectLaunchSecretSyncError,
	resolveProjectLaunchSecretValueOverlay,
	syncProjectLaunchHostBindingSecrets,
} from '../operations/services/configuration/template-secret-sync.ts';

export type {
	ProjectLaunchResolvedSecretValueItem,
	ProjectLaunchSecretSyncAdapters,
	ProjectLaunchSecretSyncProgressEvent,
	ProjectLaunchSecretSyncProvider,
	ProjectLaunchSecretSyncProviderStatus,
	ProjectLaunchSecretSyncProviderSummary,
	ProjectLaunchSecretSyncResult,
	ProjectLaunchSecretSyncStatus,
	ProjectLaunchSecretSyncSummaryItem,
	ProjectLaunchSecretSyncTargetKind,
	ProjectLaunchSecretValueDiagnostic,
	ProjectLaunchSecretValueOverlayResult,
	ResolveProjectLaunchSecretValueOverlayOptions,
	SyncProjectLaunchHostBindingSecretsOptions,
} from '../operations/services/configuration/template-secret-sync.ts';
