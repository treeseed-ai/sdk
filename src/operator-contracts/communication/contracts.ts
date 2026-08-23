import { z } from 'zod';

// Portable communication payloads shared by CLI, API, MCP, and provider runtimes.

export const communicationRecipientSchema = z.object({
	projectId: z.string().min(1),
	agentSlug: z.string().min(1),
}).strict();

export const communicationSendRequestSchema = z.object({
	message: z.string().trim().min(1).max(100_000),
	topic: z.string().trim().min(1).max(240).optional(),
	projectId: z.string().min(1).optional(),
	recipients: z.array(z.string().trim().min(1)).max(100).optional(),
	waitSeconds: z.number().int().min(0).max(3_600).optional(),
}).strict();

export const communicationTargetSchema = communicationRecipientSchema.extend({
	projectSlug: z.string().min(1),
	definitionRevision: z.string().min(1),
	invocationId: z.string().min(1).nullable(),
	status: z.enum(['queued', 'running', 'responded', 'failed', 'cancelled']),
});

export const communicationResponseSchema = communicationRecipientSchema.extend({
	invocationId: z.string().min(1),
	assignmentId: z.string().min(1).nullable(),
	messageRef: z.string().min(1),
	markdown: z.string(),
	status: z.enum(['responded', 'failed', 'cancelled']),
	createdAt: z.string().datetime(),
});

export const communicationSendReceiptSchema = z.object({
	schemaVersion: z.literal('treeseed.communication-send-receipt/v1'),
	sendId: z.string().min(1),
	teamId: z.string().min(1),
	channel: z.string().min(1),
	topic: z.string().nullable(),
	discussionId: z.string().min(1),
	messageRef: z.string().min(1),
	status: z.enum(['queued', 'running', 'complete', 'partial', 'failed']),
	targets: z.array(communicationTargetSchema),
	responses: z.array(communicationResponseSchema),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
}).strict();

export const providerDiscussionResponseRequestSchema = z.object({
	leaseToken: z.string().min(1),
	runnerId: z.string().min(1),
	markdown: z.string().trim().min(1).max(100_000),
	summary: z.string().trim().min(1).max(4_000).optional(),
	usage: z.record(z.unknown()).optional(),
}).strict();

export const providerDiscussionResponseReceiptSchema = z.object({
	schemaVersion: z.literal('treeseed.provider-discussion-response-receipt/v1'),
	assignmentId: z.string().min(1),
	invocationId: z.string().min(1),
	messageRef: z.string().min(1),
	status: z.literal('responded'),
	settledAt: z.string().datetime(),
}).strict();

export type CommunicationSendRequest = z.infer<typeof communicationSendRequestSchema>;
export type CommunicationSendReceipt = z.infer<typeof communicationSendReceiptSchema>;
export type CommunicationResponse = z.infer<typeof communicationResponseSchema>;
export type ProviderDiscussionResponseRequest = z.infer<typeof providerDiscussionResponseRequestSchema>;
export type ProviderDiscussionResponseReceipt = z.infer<typeof providerDiscussionResponseReceiptSchema>;
