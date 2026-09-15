import { z } from 'zod';
import { activityProfileSchema } from '../../../validation/agent-definition-schema.ts';

const identifier = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const timestamp = z.string().datetime({ offset: true });
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const commit = z.string().regex(/^[a-f0-9]{40}$/u);
const uniqueStrings = z.array(z.string().min(1)).superRefine((items, context) => {
	if (new Set(items).size !== items.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Values must be unique.' });
});

export const exactEntityReferenceSchema = z.object({
	store: z.enum(['treedx', 'postgresql', 'git', 'url']),
	model: z.string().min(1),
	id: identifier,
	revision: z.number().int().positive().optional(),
	digest: digest.optional(),
	repository: z.string().min(1).optional(),
	commit: commit.optional(),
	path: z.string().min(1).optional(),
	anchor: z.string().min(1).optional(),
	startLine: z.number().int().positive().optional(),
	endLine: z.number().int().positive().optional(),
	url: z.string().url().optional(),
}).strict().superRefine((reference, context) => {
	if (reference.endLine && !reference.startLine) context.addIssue({ code: z.ZodIssueCode.custom, path: ['startLine'], message: 'startLine is required with endLine.' });
	if (reference.store === 'treedx' && !(reference.commit || (reference.revision && reference.digest))) context.addIssue({ code: z.ZodIssueCode.custom, message: 'TreeDX references require commit or revision and digest.' });
	if (reference.store === 'git' && !(reference.repository && reference.commit)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Git references require repository and commit.' });
	if (reference.store === 'url' && !reference.url) context.addIssue({ code: z.ZodIssueCode.custom, message: 'URL references require url.' });
});

export const assignmentReferenceSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('git'), repository: z.string().min(1), commit, branch: z.string().min(1).optional(), path: z.string().min(1).optional() }).strict(),
	z.object({ kind: z.literal('treedx'), projectId: identifier, repository: z.string().min(1), commit, path: z.string().min(1), workspaceId: identifier.optional() }).strict(),
	z.object({ kind: z.literal('url'), url: z.string().url(), digest: digest.optional() }).strict(),
]);

export const exactGrantSchema = z.object({
	contentRead: z.array(exactEntityReferenceSchema),
	contentWrite: z.array(exactEntityReferenceSchema),
	sourceRead: uniqueStrings,
	sourceWrite: uniqueStrings,
	tools: uniqueStrings,
}).strict();

export const assignmentWorkspaceSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('read-only') }).strict(),
	z.object({ mode: z.literal('treedx'), workspaceId: identifier, repository: z.string().min(1), baseCommit: commit, writablePaths: uniqueStrings.refine((paths) => paths.length > 0) }).strict(),
	z.object({ mode: z.literal('git'), repository: z.string().min(1), baseCommit: commit, branch: z.string().min(1), writablePaths: uniqueStrings.refine((paths) => paths.length > 0) }).strict(),
]);

export const estimateSchema = z.object({
	minimumSeconds: z.number().int().positive(),
	expectedSeconds: z.number().int().positive(),
	maximumSeconds: z.number().int().positive(),
	rationale: z.string().optional(),
}).strict().refine((value) => value.minimumSeconds <= value.expectedSeconds && value.expectedSeconds <= value.maximumSeconds, {
	message: 'Estimate must satisfy minimumSeconds <= expectedSeconds <= maximumSeconds.',
});

export const effectiveActivityProfileSchema = activityProfileSchema.omit({ dependsOn: true }).extend({
	profileRef: exactEntityReferenceSchema,
	activity: z.enum(['planning', 'estimating', 'acting', 'reviewing', 'reporting', 'chat']),
	handlerOrigin: z.enum(['agent-package', 'project-runtime']),
	permissionCeiling: activityProfileSchema.shape.permissions,
}).omit({ permissions: true }).strict();

const providerSelectionSchema = z.object({ providerId: identifier, offerId: identifier, offerRevision: z.number().int().positive(), runtimeBuild: digest }).strict();
const limitsSchema = z.object({
	maximumSeconds: z.number().int().positive(),
	maximumContextBytes: z.number().int().positive(),
	maximumContextTokens: z.number().int().positive().optional(),
	maximumContextItems: z.number().int().positive(),
}).strict();

export const assignmentAttemptSchema = z.object({
	schemaVersion: z.literal('treeseed.assignment-attempt/v1'),
	id: identifier,
	idempotencyKey: identifier,
	teamId: identifier,
	projectId: identifier,
	workdayId: identifier,
	nodeId: identifier,
	workItemId: identifier.optional(),
	nodeRevision: z.number().int().positive(),
	graphRevision: z.number().int().positive(),
	sourceRef: exactEntityReferenceSchema,
	authorityRefs: z.array(exactEntityReferenceSchema).min(1),
	effectiveProfile: effectiveActivityProfileSchema,
	requiredCapabilities: uniqueStrings,
	grant: exactGrantSchema,
	provider: providerSelectionSchema,
	contextRefs: z.array(exactEntityReferenceSchema),
	predecessorResultIds: uniqueStrings,
	acceptanceCriteria: z.array(z.string().trim().min(1)).min(1).optional(),
	workspace: assignmentWorkspaceSchema,
	estimate: estimateSchema,
	limits: limitsSchema,
	deadline: timestamp,
	leaseId: identifier,
	reservationId: identifier,
	attempt: z.number().int().positive(),
	status: z.enum(['created', 'leased', 'running', 'completed', 'blocked', 'failed', 'cancelled', 'expired']),
	createdAt: timestamp,
	startedAt: timestamp.optional(),
	finishedAt: timestamp.optional(),
}).strict();

export const verificationRecordSchema = z.object({
	command: z.string().min(1), status: z.enum(['passed', 'failed', 'skipped']), exitCode: z.number().int(),
	outputDigest: digest, durationSeconds: z.number().int().nonnegative().optional(),
}).strict();
export const usageSchema = z.object({
	elapsedSeconds: z.number().int().nonnegative(), modelInputTokens: z.number().int().nonnegative().optional(),
	modelOutputTokens: z.number().int().nonnegative().optional(), native: z.record(z.number().nonnegative()).optional(),
}).strict();
export const diagnosticSchema = z.object({
	code: identifier, severity: z.enum(['info', 'warning', 'error']), message: z.string().min(1), ref: exactEntityReferenceSchema.optional(),
}).strict();

export const assignmentTimingAwarenessReceiptSchema = z.object({
	schemaVersion: z.literal('treeseed.assignment-timing-awareness/v1'),
	requiredChecks: z.literal(2), completedChecks: z.number().int().min(2),
	firstTool: z.literal('treedx:treeseed_time_status'), firstToolSucceeded: z.literal(true),
	lastTool: z.literal('treedx:treeseed_time_status'), lastToolSucceeded: z.literal(true),
	firstToolCompliant: z.literal(true), finalToolCompliant: z.literal(true),
}).strict();

export const assignmentResultSchema = z.object({
	schemaVersion: z.literal('treeseed.assignment-result/v1'),
	id: identifier,
	assignmentId: identifier,
	status: z.enum(['completed', 'blocked', 'failed']),
	summary: z.string().min(1),
	references: z.array(assignmentReferenceSchema),
	verification: z.array(verificationRecordSchema),
	usage: usageSchema,
	diagnostics: z.array(diagnosticSchema),
	timingAwareness: assignmentTimingAwarenessReceiptSchema.optional(),
	completedAt: timestamp,
}).strict();

export const authorizedContextItemSchema = z.object({
	ref: exactEntityReferenceSchema,
	mediaType: z.string().min(1),
	digest,
	value: z.any(),
}).strict();

export const assignmentContextSchema = z.object({
	assignment: assignmentAttemptSchema,
	context: z.array(authorizedContextItemSchema),
	predecessorResults: z.array(assignmentResultSchema),
}).strict();

export type ExactEntityReference = z.infer<typeof exactEntityReferenceSchema>;
export type AssignmentReference = z.infer<typeof assignmentReferenceSchema>;
export type ExactGrant = z.infer<typeof exactGrantSchema>;
export type AssignmentWorkspace = z.infer<typeof assignmentWorkspaceSchema>;
export type EffectiveActivityProfile = z.infer<typeof effectiveActivityProfileSchema>;
export type AssignmentAttempt = z.infer<typeof assignmentAttemptSchema>;
export type AssignmentTimingAwarenessReceipt = z.infer<typeof assignmentTimingAwarenessReceiptSchema>;
export type AssignmentResult = z.infer<typeof assignmentResultSchema>;
export type AssignmentContext = z.infer<typeof assignmentContextSchema>;
