import { CatalogItemOfferMode } from '../../support/platform-contracts.ts';

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
