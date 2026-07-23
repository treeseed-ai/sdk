import type { TreeseedFieldAliasBinding } from '../field-aliases.ts';
import type {
	CapacityBusinessModel,
	CapacityLaneUnit,
	CapacityReservation,
	NativeUsageObservation,
} from '../agent-capacity/contracts/financial-records.ts';
import type {
	CapacityExecutionProvider,
	CapacityExecutionProviderNativeLimit,
	CapacityExecutionProviderObservation,
	CapacityProviderMembershipView,
} from '../capacity-provider/contracts/index.ts';
import { CatalogItem } from './commons-question-input.ts';
import { CatalogItemOfferMode, CommerceOfferMode, TemplateLaunchRequirements } from './template-launch-requirements.ts';
import { ApprovalRequest } from './planning-policy.ts';

export interface UpsertCatalogItemRequest {
	id?: string;
	kind: string;
	slug: string;
	title: string;
	summary?: string | null;
	visibility?: CatalogItem['visibility'];
	listingEnabled?: boolean;
	offerMode?: CatalogItemOfferMode;
	manifestKey?: string | null;
	artifactKey?: string | null;
	searchText?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface UpsertCatalogArtifactVersionRequest {
	id?: string;
	kind: string;
	version: string;
	contentKey: string;
	manifestKey?: string | null;
	metadata?: Record<string, unknown> | null;
	publishedAt?: string | null;
}

export interface UpsertTeamStorageLocatorRequest {
	bucketName: string;
	manifestKeyTemplate: string;
	previewRootTemplate: string;
	publicBaseUrl?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface CreateCapacityProviderRequest {
	name: string;
	launchMode: 'self_hosted' | 'managed_market_host' | 'connected_host';
}

export interface RenameCapacityProviderRequest {
	name: string;
}

export interface CreateApprovalRequestRequest {
	id?: string;
	teamId: string;
	projectId: string;
	workDayId?: string | null;
	taskId?: string | null;
	kind: string;
	severity?: 'low' | 'medium' | 'high';
	requestedByType?: ApprovalRequest['requestedByType'];
	requestedById?: string | null;
	title: string;
	summary: string;
	options?: Record<string, unknown>[];
	recommendation?: Record<string, unknown> | null;
	policySnapshot?: Record<string, unknown> | null;
	expiresAt?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface SdkFollowResult<TItem> {
	items: TItem[];
	since: string;
}

export interface SdkPickResult<TItem> {
	item: TItem | null;
	leaseToken: string | null;
}

export type SdkTemplateCatalogStatus = 'draft' | 'live' | 'archived';

export type SdkTemplateCategory = 'starter' | 'example' | 'fixture' | 'reference-app';

export interface SdkTemplateCatalogPublisher {
	id: string;
	name: string;
	url?: string;
}

export interface SdkTemplateCatalogGitSource {
	kind: 'git';
	repoUrl: string;
	directory: string;
	ref: string;
	integrity?: string;
}

export interface SdkTemplateCatalogR2Source {
	kind: 'r2';
	bucket?: string;
	objectKey: string;
	version: string;
	publicUrl?: string;
	integrity?: string;
}

export type SdkTemplateCatalogSource = SdkTemplateCatalogGitSource | SdkTemplateCatalogR2Source;

export interface SdkTemplateCatalogEntry {
	id: string;
	displayName: string;
	description: string;
	summary: string;
	status: SdkTemplateCatalogStatus;
	featured?: boolean;
	category: SdkTemplateCategory;
	audience?: string[];
	tags?: string[];
	publisher: SdkTemplateCatalogPublisher;
	publisherVerified?: boolean;
	templateVersion: string;
	templateApiVersion: number;
	minCliVersion: string;
	minCoreVersion?: string;
	fulfillment: {
		mode?: 'packaged' | 'git' | 'r2';
		source: SdkTemplateCatalogSource;
		hooksPolicy: 'builtin_only' | 'trusted_only' | 'disabled';
		supportsReconcile: boolean;
	};
	offer?: {
		priceModel?: CommerceOfferMode;
		license?: string;
		support?: string;
	};
	relatedBooks?: string[];
	relatedKnowledge?: string[];
	relatedObjectives?: string[];
	launchRequirements?: TemplateLaunchRequirements;
}

export interface SdkTemplateCatalogResponse {
	items: SdkTemplateCatalogEntry[];
	meta?: Record<string, unknown>;
}
