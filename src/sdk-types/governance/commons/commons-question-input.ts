import type { FieldAliasBinding } from '../../../entrypoints/models/field-aliases.ts';
import type {
	CapacityBusinessModel,
	CapacityLaneUnit,
	CapacityReservation,
	NativeUsageObservation,
} from '../../../agent-capacity/contracts/support/financial-records.ts';
import type {
	CapacityExecutionProvider,
	CapacityExecutionProviderNativeLimit,
	CapacityExecutionProviderObservation,
	CapacityProviderMembershipView,
} from '../../../capacity-provider/contracts/index.ts';
import { CatalogItemOfferMode } from '../../support/template-launch-requirements.ts';
import { ProjectDeploymentEnvironment, ProjectDeploymentKind, ProjectDeploymentStatus, ProjectEnvironmentName, ProjectInfrastructureResourceKind, ProjectInfrastructureResourceProvider, ProjectWebDeploymentAction, ProjectWebMonitorCheckSource, ProjectWebMonitorCheckStatus, ProjectWebMonitorStatus, HostingKind, HostingRegistration } from '../../support/sdk-model-names.ts';

export interface CommonsQuestionInput {
	title: string;
	body: string;
	metadata?: Record<string, unknown>;
}

export interface CommonsProposalInput {
	title: string;
	summary: string;
	body: string;
	scope?: string;
	decisionType?: string;
	metadata?: Record<string, unknown>;
}

export interface CommonsDecisionInput {
	reason?: string | null;
	evidence?: Record<string, unknown>;
	capacityBudget?: string | null;
	scheduledFor?: string | null;
}

export interface TeamStorageLocator {
	id: string;
	teamId: string;
	bucketName: string;
	manifestKeyTemplate: string;
	previewRootTemplate: string;
	publicBaseUrl: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CatalogItem {
	id: string;
	teamId: string;
	kind: string;
	slug: string;
	title: string;
	summary: string | null;
	visibility: 'public' | 'authenticated' | 'team' | 'private';
	listingEnabled: boolean;
	offerMode: CatalogItemOfferMode;
	manifestKey: string | null;
	artifactKey: string | null;
	searchText: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CatalogArtifactVersion {
	id: string;
	itemId: string;
	teamId: string;
	kind: string;
	version: string;
	contentKey: string;
	manifestKey: string | null;
	metadata?: Record<string, unknown>;
	publishedAt: string;
	createdAt: string;
	updatedAt: string;
}

export interface ProjectHosting {
	id: string;
	projectId: string;
	kind: HostingKind;
	registration: HostingRegistration;
	marketBaseUrl: string | null;
	sourceRepoOwner: string | null;
	sourceRepoName: string | null;
	sourceRepoUrl: string | null;
	sourceRepoWorkflowPath: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface EncryptedWebHostPayload {
	version: number;
	algorithm: string;
	kdf: {
		algorithm: string;
		opsLimit?: number;
		memLimit?: number;
		[key: string]: unknown;
	};
	salt: string;
	nonce: string;
	ciphertext: string;
}

export type TeamWebHostProvider = 'cloudflare' | 'railway' | 'openai' | 'github_copilot' | 'openrouter' | 'custom';

export type TeamWebHostOwnership = 'team_owned' | 'treeseed_managed';

export interface TeamWebHost {
	id: string;
	teamId: string;
	provider: TeamWebHostProvider;
	ownership: TeamWebHostOwnership;
	name: string;
	accountLabel: string | null;
	allowedEnvironments: ProjectEnvironmentName[];
	status: string;
	encryptedPayload: EncryptedWebHostPayload | null;
	metadata?: Record<string, unknown>;
	createdById: string | null;
	updatedById: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface UpsertTeamWebHostRequest {
	id?: string;
	provider?: TeamWebHostProvider;
	ownership?: TeamWebHostOwnership;
	name: string;
	accountLabel?: string | null;
	allowedEnvironments?: ProjectEnvironmentName[];
	status?: string;
	encryptedPayload?: EncryptedWebHostPayload | null;
	metadata?: Record<string, unknown> | null;
}

export interface ProjectEnvironment {
	id: string;
	projectId: string;
	environment: ProjectEnvironmentName;
	deploymentProfile: HostingKind;
	baseUrl: string | null;
	cloudflareAccountId: string | null;
	pagesProjectName: string | null;
	workerName: string | null;
	r2BucketName: string | null;
	d1DatabaseName: string | null;
	queueName: string | null;
	railwayProjectName: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface ProjectInfrastructureResource {
	id: string;
	projectId: string;
	environment: ProjectEnvironmentName;
	provider: ProjectInfrastructureResourceProvider;
	resourceKind: ProjectInfrastructureResourceKind;
	logicalName: string;
	locator: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface ProjectDeployment {
	id: string;
	teamId: string | null;
	projectId: string;
	environment: ProjectEnvironmentName;
	deploymentKind: ProjectDeploymentKind;
	action: ProjectWebDeploymentAction | string;
	status: ProjectDeploymentStatus;
	platformOperationId: string | null;
	retryOfDeploymentId: string | null;
	resumedFromDeploymentId: string | null;
	idempotencyKey: string | null;
	requestedByUserId: string | null;
	sourceRef: string | null;
	releaseTag: string | null;
	commitSha: string | null;
	triggeredByType: string | null;
	triggeredById: string | null;
	repository?: Record<string, unknown>;
	externalWorkflow?: Record<string, unknown>;
	target?: Record<string, unknown>;
	monitor?: Record<string, unknown>;
	summary: string | null;
	error?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	startedAt: string | null;
	finishedAt: string | null;
	createdAt: string;
	updatedAt: string;
	completedAt: string | null;
}

export interface ProjectWebMonitorCheck {
	key: string;
	label: string;
	status: ProjectWebMonitorCheckStatus;
	summary: string;
	source: ProjectWebMonitorCheckSource;
	url?: string;
	inspectCommand?: string;
}

export interface ProjectWebMonitorResult {
	environment: ProjectDeploymentEnvironment;
	status: ProjectWebMonitorStatus;
	checkedAt: string;
	checks: ProjectWebMonitorCheck[];
	urls: string[];
	warnings: string[];
	contentRuntime?: {
		contentRuntimeSource: string;
		effectiveContentSource: string;
		manifestKey: string | null;
		overlayKey?: string | null;
		revision?: string | null;
		snapshotId?: string | null;
		diagnostics: Array<{
			code: string;
			status: string;
			summary: string;
			source: string;
		}>;
	};
}

export interface ProjectDeploymentEvent {
	id: string;
	deploymentId: string;
	projectId: string;
	teamId: string;
	operationId: string | null;
	kind: string;
	message: string;
	status: string | null;
	severity: string;
	sequence: number;
	payload?: Record<string, unknown>;
	createdAt: string;
}

export interface ProjectDeploymentActionAvailability {
	environment: ProjectDeploymentEnvironment;
	action: ProjectWebDeploymentAction;
	available: boolean;
	blockedBy: Array<{
		code: string;
		message: string;
		href?: string;
	}>;
}

export interface ProjectDeploymentReadiness {
	ready: boolean;
	blockers: Array<{ code: string; message: string; href?: string }>;
	checks: Array<{ code: string; label: string; ready: boolean; message: string; href?: string }>;
}
