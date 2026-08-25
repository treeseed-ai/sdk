import { z } from 'zod';

// Portable communication payloads shared by CLI, API, MCP, and provider runtimes.

export const communicationRecipientSchema = z.object({
	projectId: z.string().min(1),
	agentSlug: z.string().min(1),
}).strict();

export const communicationSendRequestSchema = z.object({
	message: z.string().trim().min(1).max(100_000),
	projectId: z.string().min(1),
	recipients: z.array(z.string().trim().min(1)).max(100).optional(),
	timeoutSeconds: z.number().int().min(1).max(3_600).optional(),
}).strict();

export const communicationTargetSchema = communicationRecipientSchema.extend({
	projectSlug: z.string().min(1),
	definitionRevision: z.string().min(1),
	revisions: z.object({
		project: z.string().min(1),
		library: z.string().min(1),
		agentDefinition: z.string().min(1),
		chatProfile: z.string().min(1),
	}).strict(),
	invocationId: z.string().min(1).nullable(),
	requirement: z.enum(['required', 'optional']),
	parentInvocationId: z.string().min(1).nullable(),
	depth: z.number().int().nonnegative(),
	status: z.enum(['queued', 'running', 'responded', 'abstained', 'failed', 'cancelled']),
	requestedAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
	completedAt: z.string().datetime().nullable(),
	failure: z.object({ code: z.string().min(1), message: z.string().nullable() }).strict().nullable(),
	capacity: z.object({
		assignmentId: z.string().min(1).nullable(),
		providerId: z.string().min(1).nullable(),
		executionProviderId: z.string().min(1).nullable(),
		laneId: z.string().min(1).nullable(),
		lanePurpose: z.string().min(1).nullable(),
		status: z.string().min(1).nullable(),
		assignedAt: z.string().datetime().nullable(),
		claimedAt: z.string().datetime().nullable(),
		completedAt: z.string().datetime().nullable(),
		returnedAt: z.string().datetime().nullable(),
		failedAt: z.string().datetime().nullable(),
	}).strict(),
});

export const communicationResponseSchema = communicationRecipientSchema.extend({
	invocationId: z.string().min(1),
	assignmentId: z.string().min(1).nullable(),
	messageRef: z.string().min(1),
	markdown: z.string(),
	requirement: z.enum(['required', 'optional']),
	status: z.enum(['responded', 'abstained', 'failed', 'cancelled']),
	createdAt: z.string().datetime(),
});

export const communicationSendReceiptSchema = z.object({
	schemaVersion: z.literal('treeseed.communication-send-receipt/v2'),
	sendId: z.string().min(1),
	teamId: z.string().min(1),
	channel: z.string().min(1),
	topic: z.object({ id: z.string().min(1), slug: z.string().min(1) }).strict(),
	projectStream: z.object({ id: z.string().min(1), projectId: z.string().min(1), projectSlug: z.string().min(1) }).strict(),
	discussionId: z.string().min(1),
	messageRef: z.string().min(1),
	sourceMessage: z.string(),
	status: z.enum(['queued', 'running', 'complete', 'partial', 'failed']),
	targets: z.array(communicationTargetSchema),
	responses: z.array(communicationResponseSchema),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
	replayed: z.boolean(),
}).strict();

export const providerDiscussionResponseRequestSchema = z.object({
	leaseToken: z.string().min(1),
	runnerId: z.string().min(1),
	outcome: z.enum(['responded', 'abstained']).default('responded'),
	markdown: z.string().trim().min(1).max(100_000).optional(),
	summary: z.string().trim().min(1).max(4_000).optional(),
	usage: z.record(z.unknown()).optional(),
}).strict().superRefine((value, context) => {
	if (value.outcome === 'responded' && !value.markdown) context.addIssue({ code: z.ZodIssueCode.custom, path: ['markdown'], message: 'A response requires Markdown.' });
});

export const providerDiscussionResponseReceiptSchema = z.object({
	schemaVersion: z.literal('treeseed.provider-discussion-response-receipt/v1'),
	assignmentId: z.string().min(1),
	invocationId: z.string().min(1),
	messageRef: z.string().min(1),
	status: z.enum(['responded', 'abstained']),
	settledAt: z.string().datetime(),
}).strict();

export type CommunicationSendRequest = z.infer<typeof communicationSendRequestSchema>;
export type CommunicationSendReceipt = z.infer<typeof communicationSendReceiptSchema>;
export type CommunicationResponse = z.infer<typeof communicationResponseSchema>;
export type ProviderDiscussionResponseRequest = z.infer<typeof providerDiscussionResponseRequestSchema>;
export type ProviderDiscussionResponseReceipt = z.infer<typeof providerDiscussionResponseReceiptSchema>;
