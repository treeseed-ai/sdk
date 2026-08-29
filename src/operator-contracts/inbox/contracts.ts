import { z } from 'zod';

export const inboxItemKindSchema = z.enum(['proposal', 'question']);
export const inboxItemStatusSchema = z.enum(['outstanding', 'answered', 'approved', 'rejected', 'closed', 'deleted']);
export const inboxActionKindSchema = z.enum(['publish_revision', 'approve', 'reject', 'comment', 'answer', 'reply', 'reopen']);

export const inboxProvenanceSchema = z.object({
	repositoryId: z.string().nullable(), contentPath: z.string().nullable(), commitSha: z.string().nullable(), digest: z.string().nullable(),
}).strict();

export const inboxActionDescriptorSchema = z.object({
	action: inboxActionKindSchema, label: z.string(), enabled: z.boolean(), reason: z.string().nullable(),
	requiresFeedback: z.boolean(), confirmation: z.enum(['never', 'input_required']),
}).strict();

export const inboxCommentSchema = z.object({
	id: z.string(), parentId: z.string().nullable(), kind: z.enum(['comment', 'answer', 'reply']), authorId: z.string(),
	authorLabel: z.string(), markdown: z.string(), createdAt: z.string().datetime(), provenance: inboxProvenanceSchema,
}).strict();

export const inboxItemSchema = z.object({
	schemaVersion: z.literal('treeseed.inbox-item/v1'), id: z.string(), teamId: z.string(), projectId: z.string(), projectSlug: z.string(),
	kind: inboxItemKindSchema, title: z.string(), markdown: z.string(), status: inboxItemStatusSchema,
	authorId: z.string(), authorLabel: z.string(), version: z.number().int().positive(), discussionId: z.string().nullable(),
	createdAt: z.string().datetime(), updatedAt: z.string().datetime(), provenance: inboxProvenanceSchema,
	availableActions: z.array(inboxActionDescriptorSchema), comments: z.array(inboxCommentSchema), etag: z.string(),
}).strict();

export const inboxItemSummarySchema = inboxItemSchema.pick({
	id: true, teamId: true, projectId: true, projectSlug: true, kind: true, title: true, status: true,
	authorId: true, authorLabel: true, version: true, createdAt: true, updatedAt: true, etag: true,
});

export const inboxItemPageSchema = z.object({
	schemaVersion: z.literal('treeseed.inbox-page/v1'), items: z.array(inboxItemSummarySchema), cursor: z.string().nullable(),
}).strict();

export const inboxEventSchema = z.object({
	schemaVersion: z.literal('treeseed.inbox-event/v1'), sequence: z.string(), id: z.string(), teamId: z.string(),
	itemId: z.string().nullable(), type: z.enum(['item.created', 'item.updated', 'item.deleted', 'draft.updated', 'comment.created', 'question.answered', 'question.reopened', 'proposal.revised', 'proposal.decided']),
	actorId: z.string(), occurredAt: z.string().datetime(), summary: z.string(), payload: z.record(z.unknown()),
}).strict();

export const inboxTimelineSchema = z.object({ events: z.array(inboxEventSchema), cursor: z.string() }).strict();
export const inboxDraftPurposeSchema = z.enum(['feedback', 'proposal_revision']);
export const inboxDraftSchema = z.object({ schemaVersion: z.literal('treeseed.inbox-draft/v1'), itemId: z.string(), purpose: inboxDraftPurposeSchema,
	markdown: z.string(), baseVersion: z.number().int().positive(), revision: z.number().int().nonnegative(), updatedAt: z.string().datetime(), etag: z.string() }).strict();
export const inboxDraftWriteSchema = z.object({ markdown: z.string().max(100_000), baseVersion: z.number().int().positive() }).strict();
export const inboxQuestionCreateSchema = z.object({ projectId: z.string(), title: z.string().trim().min(1).max(180), markdown: z.string().trim().min(1).max(100_000),
	recipients: z.array(z.string()).max(64).default([]), relatedObjectives: z.array(z.string()).max(64).default([]) }).strict();
export const inboxActionRequestSchema = z.object({ action: inboxActionKindSchema, markdown: z.string().max(100_000).optional(),
	parentId: z.string().optional(), changeReason: z.string().max(2_000).optional(), draftRevision: z.number().int().nonnegative().optional() }).strict();
export const inboxMutationReceiptSchema = z.object({ schemaVersion: z.literal('treeseed.inbox-mutation-receipt/v1'), item: inboxItemSchema,
	action: inboxActionKindSchema.optional(), replayed: z.boolean(), receipts: z.array(z.record(z.unknown())).default([]) }).strict();

export type InboxItem = z.infer<typeof inboxItemSchema>;
export type InboxDraft = z.infer<typeof inboxDraftSchema>;
