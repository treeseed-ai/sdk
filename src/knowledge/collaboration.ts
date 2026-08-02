export const KNOWLEDGE_WORKSPACE_STATUSES = ['draft', 'submitted', 'changes-requested', 'approved', 'published', 'conflicted', 'abandoned'] as const;
export const KNOWLEDGE_REVIEW_STATUSES = ['open', 'approved', 'changes-requested', 'superseded'] as const;

export type KnowledgeWorkspaceStatus = (typeof KNOWLEDGE_WORKSPACE_STATUSES)[number];
export type KnowledgeReviewStatus = (typeof KNOWLEDGE_REVIEW_STATUSES)[number];

export interface KnowledgeAuthoringWorkspace {
	id: string;
	teamId: string;
	projectId: string;
	repositoryId: string;
	treeDxWorkspaceId: string;
	actorUserId: string;
	baseRef: string;
	baseCommitSha: string;
	branchName: string;
	allowedPaths: string[];
	status: KnowledgeWorkspaceStatus;
	version: number;
	createdAt: string;
	updatedAt: string;
}

export interface KnowledgeReview {
	id: string;
	workspaceId: string;
	status: KnowledgeReviewStatus;
	submittedByUserId: string;
	decidedByUserId?: string;
	notes?: string;
	commitSha?: string;
	changedPaths: string[];
	contextDigest?: string;
	requiresEditorialReview: boolean;
	requiresGraphReview: boolean;
	editorialGateSatisfied: boolean;
	technicalReview?: import('./editorial-review.ts').EditorialReviewResult;
	audienceReview?: import('./editorial-review.ts').EditorialReviewResult;
	graphReview?: import('./editorial-review.ts').EditorialReviewResult;
	requiredReviewerIds: Partial<Record<import('./editorial-review.ts').EditorialReviewKind, string>>;
	createdAt: string;
	updatedAt: string;
}

export interface KnowledgeReviewComment {
	id: string;
	reviewId: string;
	authorUserId: string;
	path: string;
	lineStart?: number;
	lineEnd?: number;
	body: string;
	status: 'open' | 'resolved';
	resolvedByUserId?: string;
	version: number;
	createdAt: string;
	updatedAt: string;
}

export interface KnowledgeWorkspacePresence {
	workspaceId: string;
	userId: string;
	lastSeenAt: string;
}

export interface KnowledgePublication {
	id: string;
	workspaceId: string;
	reviewId: string;
	projectId: string;
	commitSha: string;
	publishedRef: string;
	publishedRevision?: string;
	status: 'queued' | 'publishing' | 'completed' | 'failed';
	createdAt: string;
	completedAt?: string;
}

export interface KnowledgeWorkspaceCreateRequest {
	projectId: string;
	baseRef?: string;
}

export interface KnowledgeCheckpointRequest {
	path: string;
	content: string;
	expectedSha?: string;
	version: number;
}

export interface KnowledgeReviewDecisionRequest {
	decision: 'approve' | 'request-changes';
	notes: string;
	version: number;
}

export interface KnowledgeEditorialReviewRequest {
	result: import('./editorial-review.ts').EditorialReviewResult;
}
