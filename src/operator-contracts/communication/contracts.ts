import { z } from 'zod';

// Portable communication payloads shared by CLI, API, MCP, and provider runtimes.

export const communicationRecipientSchema = z.object({
	projectId: z.string().min(1),
	agentSlug: z.string().min(1),
}).strict();

export const communicationSendRequestSchema = z.object({
	message: z.string().trim().min(1).max(100_000),
	recipients: z.array(z.string().trim().min(1)).max(100).optional(),
	timeoutSeconds: z.number().int().min(1).max(3_600).optional(),
}).strict();

export const communicationTopicEventTypeSchema = z.enum([
	'message.posted', 'mention.acknowledged', 'response_lease.accepted', 'agent.progress',
	'agent.response', 'agent.abstained', 'agent.failed',
]);

export const communicationTopicEventSchema = z.object({
	id: z.string().min(1),
	sequence: z.number().int().positive(),
	teamId: z.string().min(1),
	topicId: z.string().min(1),
	channel: z.string().min(1),
	type: communicationTopicEventTypeSchema,
	occurredAt: z.string().datetime(),
	sendId: z.string().min(1).nullable(),
	invocationId: z.string().min(1).nullable(),
	assignmentId: z.string().min(1).nullable(),
	actor: z.object({ kind: z.enum(['user', 'agent', 'provider', 'control-plane']), id: z.string().min(1), handle: z.string().min(1).nullable() }).strict(),
	summary: z.string().min(1),
	payload: z.record(z.unknown()),
}).strict();

export const communicationDiagnosticSchema = z.object({
	availability: z.enum(['available', 'partial', 'unavailable']),
	reason: z.string().min(1).nullable(),
	provider: z.object({ providerId: z.string().min(1).nullable(), executionProviderId: z.string().min(1).nullable(), runtimeVersion: z.string().min(1).nullable() }).strict(),
	selection: z.object({ model: z.string().min(1).nullable(), capabilities: z.array(z.string()), parameters: z.record(z.unknown()) }).strict(),
	identityManifest: z.record(z.unknown()),
	contextManifest: z.array(z.record(z.unknown())),
	usage: z.array(z.record(z.unknown())),
	timing: z.record(z.unknown()),
	resources: z.record(z.unknown()),
	traceEvents: z.array(z.record(z.unknown())),
	fullPayload: z.record(z.unknown()).optional(),
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
	acknowledgedAt: z.string().datetime().nullable(),
	leaseAcceptedAt: z.string().datetime().nullable(),
	diagnostics: communicationDiagnosticSchema,
});

export const communicationResponseSchema = communicationRecipientSchema.extend({
	projectSlug: z.string().min(1),
	invocationId: z.string().min(1),
	assignmentId: z.string().min(1).nullable(),
	messageRef: z.string().min(1),
	markdown: z.string(),
	requirement: z.enum(['required', 'optional']),
	status: z.enum(['responded', 'abstained', 'failed', 'cancelled']),
	createdAt: z.string().datetime(),
});

export const communicationSendReceiptSchema = z.object({
	schemaVersion: z.literal('treeseed.communication-send-receipt/v4'),
	sendId: z.string().min(1),
	teamId: z.string().min(1),
	channel: z.string().min(1),
	topic: z.object({ id: z.string().min(1), slug: z.string().min(1) }).strict(),
	projectStreams: z.array(z.object({
		id: z.string().min(1),
		projectId: z.string().min(1),
		projectSlug: z.string().min(1),
		discussionId: z.string().min(1),
		messageRef: z.string().min(1),
	}).strict()).min(1),
	status: z.enum(['queued', 'running', 'complete', 'partial', 'failed']),
	targets: z.array(communicationTargetSchema),
	responses: z.array(communicationResponseSchema),
	events: z.array(communicationTopicEventSchema),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
	replayed: z.boolean(),
}).strict();

export const communicationTopicListenerSchema = communicationRecipientSchema.extend({
	projectSlug: z.string().min(1), agentHandle: z.string().min(1), status: z.enum(['active', 'removed']),
	subscribedAt: z.string().datetime(), updatedAt: z.string().datetime(), source: z.enum(['mention', 'operator', 'seed']),
}).strict();

export const communicationTopicSchema = z.object({
	id: z.string().min(1), teamId: z.string().min(1), slug: z.string().min(1), status: z.enum(['active', 'archived']),
	createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
	streams: z.array(z.object({ id: z.string().min(1), projectId: z.string().min(1), projectSlug: z.string().min(1), discussionId: z.string().min(1) }).strict()),
	listeners: z.array(communicationTopicListenerSchema),
}).strict();

export const communicationTopicPageSchema = z.object({ items: z.array(communicationTopicSchema), cursor: z.string().nullable() }).strict();
export const communicationTopicTimelineSchema = z.object({ topic: communicationTopicSchema, events: z.array(communicationTopicEventSchema), cursor: z.string().nullable() }).strict();

export const communicationTopicSubscriptionRequestSchema = z.object({ agent: z.string().trim().min(2).max(180) }).strict();
export const communicationTopicSubscriptionReceiptSchema = z.object({ topicId: z.string().min(1), listener: communicationTopicListenerSchema, replayed: z.boolean() }).strict();

export const providerCommunicationNotificationAcknowledgeRequestSchema = z.object({
	providerId: z.string().min(1), runnerId: z.string().min(1), observedAt: z.string().datetime(),
}).strict();
export const providerCommunicationTraceEventRequestSchema = z.object({
	leaseToken: z.string().min(1), runnerId: z.string().min(1), sequence: z.number().int().nonnegative(),
	type: z.string().min(1), occurredAt: z.string().datetime(), summary: z.string().min(1), payload: z.record(z.unknown()),
	protectedPayload: z.record(z.unknown()).optional(),
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
export type CommunicationTopicEvent = z.infer<typeof communicationTopicEventSchema>;
export type CommunicationDiagnostic = z.infer<typeof communicationDiagnosticSchema>;
export type ProviderDiscussionResponseRequest = z.infer<typeof providerDiscussionResponseRequestSchema>;
export type ProviderDiscussionResponseReceipt = z.infer<typeof providerDiscussionResponseReceiptSchema>;
