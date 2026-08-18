export const BOOK_SCHEMA_VERSION = 'treeseed.book/v2' as const;
export const KNOWLEDGE_PAGE_SCHEMA_VERSION = 'treeseed.knowledge-page/v1' as const;
export const BOOK_COLLECTION_SCHEMA_VERSION = 'treeseed.book-collection/v1' as const;
export const KNOWLEDGE_PACK_SCHEMA_VERSION = 'treeseed.knowledge-pack/v2' as const;
export const EDITORIAL_CONTEXT_SCHEMA_VERSION = 'treeseed.editorial-context/v1' as const;

export const KNOWLEDGE_VISIBILITIES = ['public', 'authenticated', 'team', 'project', 'admin'] as const;
export const KNOWLEDGE_STATUSES = ['draft', 'review', 'published', 'archived'] as const;

export type KnowledgeVisibility = (typeof KNOWLEDGE_VISIBILITIES)[number];
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];
export type SanitizedKnowledgeHtml = string & { readonly __sanitizedKnowledgeHtml: unique symbol };

export interface BookDefinition {
	schemaVersion: typeof BOOK_SCHEMA_VERSION;
	id: string;
	slug: string;
	title: string;
	summary: string;
	description: string;
	status: KnowledgeStatus;
	visibility: KnowledgeVisibility;
	order: number;
	groupIds: string[];
	audience: string[];
	relatedBookIds: string[];
	packPolicy: 'allowed' | 'restricted' | 'disabled';
	editorialCoreNoteId?: string;
	cover?: { image?: string; alt?: string };
}

export interface KnowledgeAudienceDeclaration {
	primary: string[];
	secondary: string[];
	excluded: string[];
}

export interface KnowledgeContextBindings {
	capabilityIds: string[];
	routePatterns: string[];
	resourceTypes: string[];
	actionIds: string[];
	keywords: string[];
	documentationUrls: string[];
}

export interface KnowledgePageDefinition {
	schemaVersion: typeof KNOWLEDGE_PAGE_SCHEMA_VERSION;
	id: string;
	bookId: string;
	slug: string;
	title: string;
	summary: string;
	status: KnowledgeStatus;
	visibility: KnowledgeVisibility;
	order: number;
	parentId?: string;
	groupIds: string[];
	contributors: string[];
	relatedBookIds: string[];
	relatedKnowledgeIds: string[];
	relatedNoteIds: string[];
	relatedQuestionIds: string[];
	relatedObjectiveIds: string[];
	relatedProposalIds: string[];
	relatedDecisionIds: string[];
	guaranteeIds: string[];
	audiences: KnowledgeAudienceDeclaration;
	context: KnowledgeContextBindings;
	bodyMarkdown: string;
	bodyHtml: SanitizedKnowledgeHtml;
	updatedAt?: string;
	revision: string;
	sourcePackage?: string;
}

export interface KnowledgePageSummary {
	id: string;
	bookId: string;
	slug: string;
	title: string;
	summary: string;
	visibility: KnowledgeVisibility;
	status: KnowledgeStatus;
	audiences: KnowledgeAudienceDeclaration;
	updatedAt?: string;
	canonicalPath?: string;
}

export interface KnowledgeNavigationEntry extends KnowledgePageSummary {
	order: number;
	parentId?: string;
	revision: string;
}

export interface KnowledgeReaderResponse {
	book: BookDefinition;
	navigation: KnowledgeNavigationEntry[];
	page: KnowledgePageDefinition | null;
	revision: string;
}

export interface KnowledgeContextRequest {
	pageId?: string;
	capabilityId?: string;
	routePattern?: string;
	resourceType?: string;
	locale?: string;
	teamId?: string;
	projectId?: string;
}

export interface KnowledgeContextResponse {
	page: KnowledgePageDefinition;
	relatedPages: KnowledgePageSummary[];
	searchScope: KnowledgeVisibility | 'global';
	revision: string;
}

export interface BookCollectionDefinition {
	schemaVersion: typeof BOOK_COLLECTION_SCHEMA_VERSION;
	id: string;
	teamId: string;
	name: string;
	summary?: string;
	bookIds: string[];
	createdByUserId: string;
	managed?: boolean;
	version: number;
	createdAt: string;
	updatedAt: string;
}

export type KnowledgePackBuildStatus = 'queued' | 'building' | 'completed' | 'failed' | 'cancelled' | 'expired';

export interface KnowledgePackArtifact {
	fileName: string;
	digest: string;
	byteSize: number;
	manifest: KnowledgePackManifest;
}

export interface KnowledgePackBuild {
	id: string;
	teamId: string;
	collectionId?: string;
	requestedByUserId: string;
	bookIds: string[];
	sourceClosure?: string;
	publicationRevision: string;
	status: KnowledgePackBuildStatus;
	artifact?: KnowledgePackArtifact;
	error?: string;
	version: number;
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
}

export interface KnowledgePackMember {
	teamId: string;
	projectId: string;
	repositoryId: string;
	commitSha: string;
	bookId: string;
	pageIds: string[];
	digest: string;
}

export interface KnowledgePackManifest {
	schemaVersion: typeof KNOWLEDGE_PACK_SCHEMA_VERSION;
	id: string;
	teamId: string;
	createdAt: string;
	sourceClosure: string;
	publicationRevision: string;
	publicationSourceClosure: string;
	visibility: KnowledgeVisibility;
	members: KnowledgePackMember[];
	files: Array<{ path: string; sha256: string; mediaType: string }>;
}
