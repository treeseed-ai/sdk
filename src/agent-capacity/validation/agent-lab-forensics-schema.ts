import { z } from 'zod';
import type { AgentActivityEvent } from '../contracts/capacity/workdays/workday-records.ts';

const nonEmpty = z.string().trim().min(1);
const optionalId = nonEmpty.nullable();
const jsonRecord = z.record(z.unknown());
const timestamp = z.string().datetime({ offset: true });

export const agentActivityEventSchema: z.ZodType<AgentActivityEvent> = z.object({
	id: nonEmpty,
	sequence: z.number().int().nonnegative(),
	sourceEventId: nonEmpty,
	timestamp,
	teamId: nonEmpty,
	projectId: optionalId,
	workdayId: nonEmpty,
	assignmentId: optionalId,
	modeRunId: optionalId,
	executionRunId: optionalId,
	agentId: optionalId,
	agentClassId: optionalId,
	activityType: optionalId,
	handlerId: optionalId,
	capacityProviderId: optionalId,
	providerManagerId: optionalId,
	runnerId: optionalId,
	executionProviderId: optionalId,
	eventType: nonEmpty,
	severity: z.enum(['debug', 'info', 'warning', 'error']),
	summary: nonEmpty,
	transcriptRef: optionalId,
	artifactRefs: z.array(jsonRecord),
	contextPackDigest: optionalId,
	usageDelta: jsonRecord,
	durationMs: z.number().nonnegative().finite().nullable(),
	errorCategory: optionalId,
	recoveryState: optionalId,
	redactionStatus: nonEmpty,
	payloadDigest: z.string(),
}).strict();

const csvFilter = z.union([z.string(), z.array(nonEmpty)]).optional();
export const agentActivityQuerySchema = z.object({
	after: z.coerce.number().int().min(-1).default(-1),
	limit: z.coerce.number().int().min(1).max(200).default(100),
	agent: csvFilter,
	agentClass: csvFilter,
	type: csvFilter,
	severity: csvFilter,
}).strict();

export const agentActivityPageSchema = z.object({
	items: z.array(agentActivityEventSchema).max(200),
	cursor: z.number().int().min(-1),
}).strict();

export const agentReplayRequestSchema = z.object({
	workdayId: nonEmpty.optional(),
	at: timestamp.optional(),
	cursor: z.string().nullable().optional(),
	includeDiagnostics: z.boolean().default(false),
	includePayloads: z.boolean().default(false),
}).strict().superRefine((value, context) => {
	if (!value.at && !value.cursor) context.addIssue({ code: z.ZodIssueCode.custom, path: ['at'], message: 'Provide an exact timestamp or replay cursor.' });
});

export const agentTranscriptPayloadSchema = z.object({
	executionRunId: nonEmpty,
	redactionStatus: z.enum(['sanitized', 'partially-redacted', 'withheld']),
	entries: z.array(jsonRecord),
	page: z.object({
		limit: z.number().int().positive().max(200),
		hasMore: z.boolean(),
		nextCursor: z.string().nullable(),
	}).strict(),
}).strict();

export const agentForensicPayloadSchema = z.object({
	contract: z.literal('treeseed.agent-forensic-payload/v1'),
	activity: agentActivityEventSchema,
	payload: jsonRecord.optional(),
	transcript: agentTranscriptPayloadSchema.optional(),
	diagnostics: z.array(z.object({ code: nonEmpty, path: z.string(), message: nonEmpty, severity: z.enum(['info', 'warning', 'error']) }).strict()).default([]),
}).strict();

export type AgentActivityQuery = z.infer<typeof agentActivityQuerySchema>;
export type AgentActivityPage = z.infer<typeof agentActivityPageSchema>;
export type AgentReplayRequest = z.infer<typeof agentReplayRequestSchema>;
export type AgentTranscriptPayload = z.infer<typeof agentTranscriptPayloadSchema>;
export type AgentForensicPayload = z.infer<typeof agentForensicPayloadSchema>;

export function parseAgentActivityEvent(value: unknown) { return agentActivityEventSchema.parse(value); }
export function parseAgentActivityQuery(value: unknown) { return agentActivityQuerySchema.parse(value); }
export function parseAgentActivityPage(value: unknown) { return agentActivityPageSchema.parse(value); }
export function parseAgentReplayRequest(value: unknown) { return agentReplayRequestSchema.parse(value); }
export function parseAgentTranscriptPayload(value: unknown) { return agentTranscriptPayloadSchema.parse(value); }
