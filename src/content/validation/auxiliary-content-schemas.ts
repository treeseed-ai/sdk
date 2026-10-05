import { z } from 'zod';
import { PUBLICATION_ACCESS_MODES } from '../../sdk-types/support/platform-contracts.ts';

const nonEmpty = z.string().trim().min(1);

const workdaySummaryTaskSchema = z.object({
	id: nonEmpty, agentId: nonEmpty.optional(), type: nonEmpty.optional(), state: nonEmpty.optional(),
	priority: z.number().optional(), idempotencyKey: nonEmpty.optional(), createdAt: z.coerce.date().optional(),
	startedAt: z.coerce.date().optional(), completedAt: z.coerce.date().optional(), lastErrorCode: z.string().nullable().optional(),
	lastErrorMessage: z.string().nullable().optional(), lastEventKind: z.string().nullable().optional(),
	outputCount: z.number().int().optional(), changedFiles: z.array(z.string()).default([]),
});

const workdayPriorityItemSchema = z.object({
	id: nonEmpty, model: nonEmpty, slug: nonEmpty.optional(), title: nonEmpty.optional(), status: nonEmpty.optional(),
	priority: z.number(), estimatedCredits: z.number().optional(), reason: nonEmpty.optional(),
});

const workdayReleaseSchema = z.object({
	id: nonEmpty.optional(), deploymentKind: nonEmpty, status: nonEmpty, releaseTag: z.string().nullable().optional(),
	commitSha: z.string().nullable().optional(), sourceRef: z.string().nullable().optional(),
	startedAt: z.coerce.date().optional(), finishedAt: z.coerce.date().optional(), createdAt: z.coerce.date().optional(),
});

export const workdayContentSchema = z.object({
	title: nonEmpty, slug: nonEmpty, workDayId: nonEmpty, reportVersion: nonEmpty,
	reportKind: nonEmpty.default('workday_summary'), projectId: nonEmpty, teamId: nonEmpty.optional(),
	environment: nonEmpty, status: nonEmpty.default('live'),
	visibility: z.enum(['public', 'authenticated', 'team', 'private']).default('team'), workdayState: nonEmpty,
	startedAt: z.coerce.date(), endedAt: z.coerce.date().nullable().optional(), generatedAt: z.coerce.date(),
	createdAt: z.coerce.date().optional(), summary: nonEmpty, dailyTaskCreditBudget: z.number().default(0),
	usedTaskCredits: z.number().default(0), remainingTaskCredits: z.number().default(0),
	creditLedgerEntries: z.number().int().default(0), prioritySnapshotId: z.string().nullable().optional(),
	priorityItemCount: z.number().int().default(0), priorityItems: z.array(workdayPriorityItemSchema).default([]),
	totalTasks: z.number().int().default(0), completedTasks: z.number().int().default(0),
	failedTasks: z.number().int().default(0), queuedTasks: z.number().int().default(0), activeTasks: z.number().int().default(0),
	taskItems: z.array(workdaySummaryTaskSchema).default([]), changedFiles: z.array(z.string()).default([]),
	releases: z.array(workdayReleaseSchema).default([]), scaleDecision: z.record(z.unknown()).default({}),
	scaleResult: z.record(z.unknown()).default({}), metadata: z.record(z.unknown()).default({}),
});

const publisherSchema = z.object({ id: nonEmpty, name: nonEmpty, url: z.string().url().optional() });
const templateSourceSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('git'), repoUrl: nonEmpty, directory: nonEmpty, ref: nonEmpty, integrity: nonEmpty.optional() }),
	z.object({ kind: z.literal('r2'), bucket: nonEmpty.optional(), objectKey: nonEmpty, version: nonEmpty,
		publicUrl: z.string().url().optional(), integrity: nonEmpty.optional() }),
]);

export const templateProductContentSchema = z.object({
	slug: nonEmpty, sourceRef: nonEmpty.optional(), title: nonEmpty, description: nonEmpty, summary: nonEmpty,
	status: z.enum(['draft', 'live', 'archived']), featured: z.boolean().default(false), teamId: nonEmpty.optional(),
	listingEnabled: z.boolean().default(true), category: nonEmpty, audience: z.array(z.string()).default([]),
	groupIds: z.array(z.string()).default([]), publisher: publisherSchema, publisherVerified: z.boolean().default(false),
	templateVersion: nonEmpty, templateApiVersion: z.number().int().positive(), minCliVersion: nonEmpty, minCoreVersion: nonEmpty,
	fulfillment: z.object({ mode: z.enum(['packaged', 'git', 'r2']).default('packaged'), source: templateSourceSchema,
		hooksPolicy: z.enum(['builtin_only', 'trusted_only', 'disabled']).default('builtin_only'),
		supportsReconcile: z.boolean().default(true) }),
	offer: z.object({ priceModel: z.enum(PUBLICATION_ACCESS_MODES).default('free'), license: nonEmpty.optional(),
		support: nonEmpty.optional() }).default({ priceModel: 'free' }),
	relatedBooks: z.array(z.string()).default([]), relatedKnowledge: z.array(z.string()).default([]),
	relatedObjectives: z.array(z.string()).default([]),
});

const exactRevisionRefSchema = z.object({ id:nonEmpty,revision:z.number().int().positive() }).strict();
const artifactExpectationSchema = z.object({
	id:nonEmpty,agentId:nonEmpty,activityType:nonEmpty,model:nonEmpty,pathPrefix:nonEmpty,
	subjectRefs:z.array(nonEmpty).min(1),relationFields:z.array(nonEmpty).min(1),requiredClaims:z.array(nonEmpty).min(1),
}).strict();
export const agentTestContentSchema = z.object({
	id:nonEmpty,agent:nonEmpty,kind:z.enum(['spec','handler','message_chain','manager_worker','workday','api','ui','context-query','context-query-set']),
	fixture:nonEmpty.optional(),trigger:z.record(z.unknown()).default({}),
	expect:z.object({ semanticArtifacts:z.array(artifactExpectationSchema).optional() }).passthrough().default({}),
	groupIds:z.array(z.string()).default([]),contextQueryRefs:z.array(nonEmpty).default([]),
	queryRef:exactRevisionRefSchema.optional(),querySetRef:exactRevisionRefSchema.optional(),testRef:nonEmpty.optional(),expectedIdentities:z.array(nonEmpty).optional(),
	expectedRelations:z.array(nonEmpty).optional(),expectedPaths:z.array(nonEmpty).optional(),expectedSchemaVersions:z.array(nonEmpty).optional(),
	resultBounds:z.object({ min:z.number().int().nonnegative(),max:z.number().int().positive() }).strict().optional(),
	budget:z.object({ maxContextItems:z.number().int().positive(),maxTokens:z.number().int().positive() }).strict().optional(),
	maxLatencyMs:z.number().int().positive().optional(),
}).superRefine((value,context) => {
	if (value.kind !== 'context-query' && value.kind !== 'context-query-set') return;
	const referenceField = value.kind === 'context-query' ? 'queryRef' : 'querySetRef';
	for (const field of [referenceField,'testRef','expectedIdentities','expectedRelations','expectedPaths','expectedSchemaVersions','resultBounds','budget'] as const) {
		if (value[field] === undefined) context.addIssue({ code:z.ZodIssueCode.custom,path:[field],message:`context-query tests require ${field}.` });
	}
	if (value.kind === 'context-query' && value.querySetRef !== undefined) context.addIssue({ code:z.ZodIssueCode.custom,path:['querySetRef'],message:'A context-query test cannot reference a query set.' });
	if (value.kind === 'context-query-set' && value.queryRef !== undefined) context.addIssue({ code:z.ZodIssueCode.custom,path:['queryRef'],message:'A context-query-set test cannot reference one query.' });
	if (value.resultBounds && value.resultBounds.min > value.resultBounds.max) context.addIssue({ code:z.ZodIssueCode.custom,path:['resultBounds'],message:'Result minimum cannot exceed maximum.' });
});

export const auxiliaryContentSchemas = {
	agent_test: agentTestContentSchema,
	workday: workdayContentSchema,
	template_product: templateProductContentSchema,
} satisfies Record<string, z.ZodTypeAny>;
