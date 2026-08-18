import { index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

export const knowledgeAuthoringWorkspaces = pgTable('knowledge_authoring_workspaces', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	repositoryId: text('repository_id').notNull(),
	treeDxWorkspaceId: text('treedx_workspace_id').notNull(),
	actorUserId: text('actor_user_id').notNull(),
	baseRef: text('base_ref').notNull(),
	baseCommitSha: text('base_commit_sha').notNull(),
	branchName: text('branch_name').notNull(),
	allowedPathsJson: text('allowed_paths_json').notNull().default('[]'),
	status: text('status').notNull().default('draft'),
	version: integer('version').notNull().default(1),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_knowledge_workspaces_treedx').on(table.treeDxWorkspaceId),
	index('idx_knowledge_workspaces_project_actor').on(table.projectId, table.actorUserId, table.status),
]);

export const knowledgeReviews = pgTable('knowledge_reviews', {
	id: text('id').primaryKey(),
	workspaceId: text('workspace_id').notNull(),
	status: text('status').notNull().default('open'),
	submittedByUserId: text('submitted_by_user_id').notNull(),
	decidedByUserId: text('decided_by_user_id'),
	notes: text('notes'),
	commitSha: text('commit_sha'),
	changedPathsJson: text('changed_paths_json').notNull().default('[]'),
	contextDigest: text('context_digest'),
	requiresEditorialReview: integer('requires_editorial_review').notNull().default(0),
	requiresGraphReview: integer('requires_graph_review').notNull().default(0),
	editorialGateSatisfied: integer('editorial_gate_satisfied').notNull().default(0),
	technicalReviewJson: text('technical_review_json'),
	audienceReviewJson: text('audience_review_json'),
	graphReviewJson: text('graph_review_json'),
	requiredReviewerIdsJson: text('required_reviewer_ids_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_knowledge_reviews_workspace_status').on(table.workspaceId, table.status)]);

export const knowledgeReviewComments = pgTable('knowledge_review_comments', {
	id: text('id').primaryKey(), reviewId: text('review_id').notNull(), authorUserId: text('author_user_id').notNull(),
	path: text('path').notNull(), lineStart: integer('line_start'), lineEnd: integer('line_end'), body: text('body').notNull(),
	status: text('status').notNull().default('open'), resolvedByUserId: text('resolved_by_user_id'),
	version: integer('version').notNull().default(1), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_knowledge_review_comments_review_status').on(table.reviewId, table.status)]);

export const knowledgeWorkspacePresence = pgTable('knowledge_workspace_presence', {
	id: text('id').primaryKey(), workspaceId: text('workspace_id').notNull(), userId: text('user_id').notNull(),
	lastSeenAt: text('last_seen_at').notNull(),
}, (table) => [uniqueIndex('idx_knowledge_workspace_presence_actor').on(table.workspaceId, table.userId)]);

export const knowledgePublications = pgTable('knowledge_publications', {
	id: text('id').primaryKey(),
	workspaceId: text('workspace_id').notNull(),
	reviewId: text('review_id').notNull(),
	projectId: text('project_id').notNull(),
	commitSha: text('commit_sha').notNull(),
	publishedRef: text('published_ref').notNull(),
	publishedRevision: text('published_revision'),
	status: text('status').notNull().default('queued'),
	createdAt: text('created_at').notNull(),
	completedAt: text('completed_at'),
}, (table) => [index('idx_knowledge_publications_project_status').on(table.projectId, table.status),
	uniqueIndex('idx_knowledge_publications_review').on(table.reviewId)]);

export const bookCollections = pgTable('book_collections', {
	id: text('id').primaryKey(), teamId: text('team_id').notNull(), name: text('name').notNull(),
	summary: text('summary'), bookIdsJson: text('book_ids_json').notNull().default('[]'),
	createdByUserId: text('created_by_user_id').notNull(), version: integer('version').notNull().default(1),
	createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [uniqueIndex('idx_book_collections_team_name').on(table.teamId, table.name)]);

export const knowledgePackBuilds = pgTable('knowledge_pack_builds', {
	id: text('id').primaryKey(), teamId: text('team_id').notNull(), collectionId: text('collection_id'),
	requestedByUserId: text('requested_by_user_id').notNull(), bookIdsJson: text('book_ids_json').notNull().default('[]'),
	sourceClosure: text('source_closure'),
	publicationRevision: text('publication_revision').notNull(),
	status: text('status').notNull().default('queued'), artifactJson: text('artifact_json').notNull().default('{}'),
	error: text('error'), version: integer('version').notNull().default(1), createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(), completedAt: text('completed_at'),
}, (table) => [index('idx_knowledge_pack_builds_team_status').on(table.teamId, table.status)]);
