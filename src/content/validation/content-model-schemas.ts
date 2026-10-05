import { z } from 'zod';
import { conditionalFields, uniqueArray as unique } from './schema-constraints.ts';
import { agentClassSchema as agentClass, agentDefinitionSchema, permissionSetSchema } from '../../agent-capacity/validation/agent-definition-schema.ts';
import { PROPOSAL_TYPE_ID_PATTERN } from '../../agent-capacity/validation/proposal-type.ts';
import {
	BOOK_SCHEMA_VERSION,
	KNOWLEDGE_PAGE_SCHEMA_VERSION,
	KNOWLEDGE_STATUSES,
	KNOWLEDGE_VISIBILITIES,
} from '../../knowledge/contracts.ts';
import { auxiliaryContentSchemas } from './auxiliary-content-schemas.ts';
import { agentOperationalContentSchemas } from './agent-operational-content-schemas.ts';
import { exactEntityReferenceSchema, estimateSchema } from '../../agent-capacity/contracts/capacity/assignments/agent-execution.ts';
export { agentTestContentSchema, templateProductContentSchema, workdayContentSchema } from './auxiliary-content-schemas.ts';
export * from './agent-operational-content-schemas.ts';

const nonEmpty = z.string().trim().min(1);
const strings = z.array(z.string());
const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const slug = z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/u);
const identifiers = z.array(identifier);
const date = z.coerce.date();
const lifecycleStatus = z.enum(['live', 'in progress', 'exploratory', 'planned', 'speculative']);
const exactRefs = z.array(exactEntityReferenceSchema);
export const exactDependencyLinkSchema = z.object({ relation: z.literal('depends_on'),
	from: exactEntityReferenceSchema, to: exactEntityReferenceSchema }).strict().superRefine((link, context) => {
	for (const end of ['from', 'to'] as const) {
		const ref = link[end];
		if (ref.store !== 'treedx' || ref.model !== 'proposal' || !ref.repository || !ref.commit || !ref.path
			|| !ref.digest || !ref.revision || !/^work-item\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(ref.anchor ?? '')) {
			context.addIssue({ code: z.ZodIssueCode.custom, path: [end],
				message: 'A dependency endpoint must identify an exact proposal work item.' });
		}
	}
	if (JSON.stringify(link.from) === JSON.stringify(link.to)) context.addIssue({ code: z.ZodIssueCode.custom,
		message: 'A work item cannot depend on itself.' });
});
const linked = {
	group_ids: strings.optional(),
	related_objectives: strings.optional(),
	related_questions: strings.optional(),
	related_proposals: strings.optional(),
	related_decisions: strings.optional(),
	related_books: strings.optional(),
};
const governanceBase = {
	title: nonEmpty,
	description: nonEmpty.optional(),
	date: date.optional(),
	status: lifecycleStatus.optional(),
	summary: nonEmpty.optional(),
	draft: z.boolean().optional(),
	group_ids: strings.optional(),
};

const proposalPlanSchema = z.object({
	desiredOutcome: nonEmpty,
	currentProblem: nonEmpty,
	proposedApproach: nonEmpty,
	scope: strings,
	nonGoals: strings,
	deliverables: strings,
	acceptanceCriteria: strings,
	risks: strings,
	dependencies: strings,
	alternatives: strings,
	verification: strings,
	openQuestions: strings.optional(),
});

const proposalLinks = {
	related_notes: strings.optional(), evidence_refs: strings.optional(),
	decision_dependencies: z.array(z.object({ projectId: nonEmpty, decisionId: nonEmpty }).strict()).optional(),
	...linked,
};

const executionPlanWorkItemSchema = z.object({
	id: nonEmpty.max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
	priority: z.number().int().safe().optional(),
	activity: z.literal('acting'),
	agentClass,
	workspace: z.enum(['read-only', 'treedx', 'git']),
	review: z.enum(['required', 'none']),
	objective: nonEmpty,
	estimate: estimateSchema.optional(),
	reviewEstimate: estimateSchema.optional(),
	maximumReviewCycles: z.number().int().positive().optional(),
	dependsOn: unique(z.array(nonEmpty.max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u))),
	requestedPermissions: permissionSetSchema,
	output: z.object({
		model: z.enum(['agent','book','knowledge','objective','discussion','discussion-message','proposal','question','note','decision']),
		id: identifier,
	}).strict().optional(),
	requiredCapabilities: unique(z.array(identifier).min(1)),
	contextRefs: unique(exactRefs).optional(),
	acceptanceCriteria: z.array(nonEmpty).min(1),
}).strict().superRefine((value, context) => {
	if (value.review === 'required' && !value.maximumReviewCycles) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Required review needs a maximum cycle count.' });
	if (value.review === 'none' && (value.reviewEstimate || value.maximumReviewCycles)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Unreviewed work cannot define review estimates or cycles.' });
	if (value.workspace !== 'read-only') {
		const mutable = (value.contextRefs ?? []).filter((reference) => reference.store === value.workspace && reference.model === 'repository');
		if (mutable.length !== 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ['contextRefs'], message: `${value.workspace} work requires exactly one exact ${value.workspace} workspace reference.` });
	}
	if (value.output && (value.workspace !== 'treedx' || !value.requestedPermissions.content.write.includes(value.output.model))) {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['output'], message: 'A content output requires a TreeDX workspace and matching content-write authority.' });
	}
});

const executionPlanSchema = z.object({ workItems: z.array(executionPlanWorkItemSchema).min(1) }).strict().superRefine((value, context) => {
	const ids = new Set(value.workItems.map((item) => item.id));
	if (ids.size !== value.workItems.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Work-item IDs must be unique.' });
	for (const [index, item] of value.workItems.entries()) for (const dependency of item.dependsOn) {
		if (!ids.has(dependency)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['workItems', index, 'dependsOn'], message: `Dependency ${dependency} does not exist in this proposal.` });
		if (dependency === item.id) context.addIssue({ code: z.ZodIssueCode.custom, path: ['workItems', index, 'dependsOn'], message: 'Work items cannot depend on themselves.' });
	}
	const byId = new Map(value.workItems.map((item) => [item.id, item]));
	const visiting = new Set<string>(), visited = new Set<string>();
	const cyclic = (id: string): boolean => {
		if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id);
		if ((byId.get(id)?.dependsOn ?? []).some(cyclic)) return true;
		visiting.delete(id); visited.add(id); return false;
	};
	if ([...ids].some(cyclic)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['workItems'], message: 'Work-item dependencies must be acyclic.' });
});

const proposalSchema = conditionalFields(z.object({
	schemaVersion: z.literal('treeseed.proposal/v1'), id: identifier, projectId: identifier, title: nonEmpty,
	request: nonEmpty, summary: nonEmpty.optional(), status: z.enum(['draft', 'discussing', 'ready', 'decided', 'withdrawn']),
	objectiveRefs: unique(exactRefs).optional(), evidenceRefs: unique(exactRefs).optional(),
	discussionRef: exactEntityReferenceSchema.optional(), executionPlan: executionPlanSchema.optional(),
}).strict(), [{ field: 'status', in: ['ready', 'decided'], alternatives: [['summary', 'executionPlan']],
	items: { field: 'executionPlan', key: 'workItems', required: ['estimate'],
		conditional: { field: 'review', equals: 'required', required: ['reviewEstimate'] } },
	message: 'Ready proposals require a summary, an execution plan, and each required independent estimate.' }]);

const schemas = {
	page: z.object({
		title: nonEmpty, description: nonEmpty.optional(), slug: nonEmpty.optional(), page_layout: z.enum(['article', 'bridge']).optional(),
		status: lifecycleStatus.optional(), stage: nonEmpty.optional(), audience: strings.optional(), summary: nonEmpty.optional(), updated_at: date.optional(),
	}),
	note: conditionalFields(z.object({
		schemaVersion: z.literal('treeseed.note/v1'), id: identifier, projectId: identifier,
		classification: z.enum(['general', 'feedback', 'research', 'workday-report']),
		subjectRefs: unique(exactRefs.min(1)), body: nonEmpty, createdAt: z.string().datetime({ offset: true }),
		links: z.array(exactDependencyLinkSchema).optional(),
	}).strict(), [{ field: 'classification', equals: 'workday-report',
		contains: { field: 'subjectRefs', properties: { store: 'postgresql', model: 'workday' } },
		path: ['subjectRefs'], message: 'Workday reports must reference their exact workday.' }]),
	question: z.object({
		schemaVersion: z.literal('treeseed.question/v1'), id: identifier, projectId: identifier,
		subjectRef: exactEntityReferenceSchema, question: nonEmpty, status: z.enum(['open', 'answered', 'withdrawn']),
		addressedTo: unique(z.array(agentClass)).optional(), answer: nonEmpty.optional(), answerRefs: unique(exactRefs).optional(),
		askedAt: z.string().datetime({ offset: true }), answeredAt: z.string().datetime({ offset: true }).optional(),
	}).strict().superRefine((value, context) => {
		if (value.status === 'answered' && !(value.answer || value.answerRefs?.length)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Answered questions require an answer or exact answer reference.' });
	}),
	objective: z.object({
		schemaVersion: z.literal('treeseed.objective/v1'), id: identifier, projectId: identifier,
		title: nonEmpty, outcome: nonEmpty, status: z.enum(['active', 'achieved', 'abandoned']),
		evidenceRefs: unique(exactRefs).optional(),
	}).strict(),
	proposal: proposalSchema,
	decision: conditionalFields(z.object({
		schemaVersion: z.literal('treeseed.decision/v1'), id: identifier, projectId: identifier,
		decisionClass: z.enum(['proposal', 'work-review', 'publication']),
		decisionMethod: z.enum(['authority', 'approval', 'vote']), subjectRef: exactEntityReferenceSchema,
		disposition: z.enum(['approved', 'rejected', 'request-changes', 'deferred', 'superseded']), rationale: nonEmpty,
		findingRefs: unique(exactRefs).optional(), authorityRefs: unique(exactRefs.min(1)), decidedByRefs: unique(exactRefs.min(1)),
		positions: z.array(z.object({ actorRef: exactEntityReferenceSchema, position: z.enum(['approve', 'reject', 'abstain']), rationale: z.string().optional(), recordedAt: z.string().datetime({ offset: true }) }).strict()).min(1).optional(),
		decidedAt: z.string().datetime({ offset: true }),
	}).strict(), [
		{ field: 'decisionMethod', in: ['approval', 'vote'], alternatives: [['positions']], path: ['positions'], message: 'Approval and vote decisions require signed positions.' },
		{ field: 'decisionClass', equals: 'work-review', allowed: { field: 'disposition', values: ['approved', 'request-changes'] },
			path: ['disposition'], message: 'Work review must approve or request changes.' },
		{ field: 'decisionClass', equals: 'proposal', allowed: { field: 'disposition', values: ['approved', 'rejected', 'deferred', 'superseded'] },
			path: ['disposition'], message: 'Only work review may request changes.' },
		{ field: 'decisionClass', equals: 'publication', allowed: { field: 'disposition', values: ['approved', 'rejected', 'deferred', 'superseded'] },
			path: ['disposition'], message: 'Only work review may request changes.' },
	]),
	book: z.object({
		schemaVersion: z.literal(BOOK_SCHEMA_VERSION), id: identifier, projectId: identifier,
		revision: z.number().int().positive(),
		order: z.number().int().nonnegative(), slug,
		title: nonEmpty, description: nonEmpty.optional(), summary: nonEmpty, status: z.enum(KNOWLEDGE_STATUSES),
		visibility: z.enum(KNOWLEDGE_VISIBILITIES), groupIds: identifiers.optional(), audience: z.array(nonEmpty).optional(), relatedBookIds: identifiers.optional(),
		packPolicy: z.enum(['allowed', 'restricted', 'disabled']).optional(), editorialCoreNoteId: identifier.optional(),
		cover: z.object({ image: nonEmpty.optional(), alt: nonEmpty.optional() }).strict().optional(),
	}).strict(),
	knowledge: z.object({
		schemaVersion: z.literal(KNOWLEDGE_PAGE_SCHEMA_VERSION), id: identifier, projectId: identifier,
		bookRef: exactEntityReferenceSchema.refine((ref) => ref.store === 'treedx' && ref.model === 'book'
			&& Boolean(ref.revision && ref.digest && ref.path), 'Knowledge requires an exact Book path, revision, and digest.'),
		slug, body: nonEmpty,
		title: nonEmpty, description: nonEmpty.optional(), summary: nonEmpty.optional(), status: z.enum(KNOWLEDGE_STATUSES),
		visibility: z.enum(KNOWLEDGE_VISIBILITIES), order: z.number().int().nonnegative().optional(), groupIds: identifiers.optional(),
		parentId: identifier.optional(), contributors: identifiers.optional(), relatedBookIds: identifiers.optional(),
		relatedKnowledgeIds: identifiers.optional(), relatedNoteIds: identifiers.optional(), relatedQuestionIds: identifiers.optional(),
		relatedObjectiveIds: identifiers.optional(), relatedProposalIds: identifiers.optional(), relatedDecisionIds: identifiers.optional(),
		guaranteeIds: identifiers.optional(), audiences: z.object({ primary: z.array(nonEmpty).optional(), secondary: z.array(nonEmpty).optional(), excluded: z.array(nonEmpty).optional() }).strict().optional(),
		relatedRefs: unique(exactRefs).optional(),
		capabilityIds: identifiers.optional(), routePatterns: z.array(nonEmpty).optional(), resourceTypes: identifiers.optional(),
		actionIds: identifiers.optional(), keywords: z.array(nonEmpty).optional(), documentationUrls: z.array(nonEmpty).optional(),
	}).strict(),
	person: z.object({
		name: nonEmpty, description: nonEmpty.optional(), summary: nonEmpty.optional(), role: nonEmpty.optional(), affiliation: nonEmpty.optional(),
		status: lifecycleStatus.optional(), group_ids: strings.optional(), related_questions: strings.optional(), related_objectives: strings.optional(),
	}),
	agent: agentDefinitionSchema,
	discussion: z.object({
		schemaVersion: z.literal('treeseed.discussion/v1'), id: identifier, projectId: identifier,
		subjectRef: exactEntityReferenceSchema, status: z.enum(['open', 'resolved', 'closed']),
		participantClasses: unique(z.array(agentClass)), title: nonEmpty, teamId: identifier, createdAt: z.string().datetime({ offset: true }),
		topic: nonEmpty.optional(), visibility: z.enum(KNOWLEDGE_VISIBILITIES).optional(),
		participantIds: identifiers.optional(), agentIds: identifiers.optional(), groupIds: identifiers.optional(),
		parentWorkdayId: identifier.optional(), updatedAt: z.string().datetime({ offset: true }).optional(),
	}).strict(),
	discussion_message: z.object({
		schemaVersion: z.literal('treeseed.discussion-message/v1'), id: identifier,
		discussionRef: exactEntityReferenceSchema, authorRef: exactEntityReferenceSchema,
		body: nonEmpty, createdAt: z.string().datetime({ offset: true }),
		replyToRef: exactEntityReferenceSchema.optional(), title: nonEmpty.optional(), discussionId: identifier.optional(),
		authorId: identifier.optional(), authorType: z.enum(['user', 'agent', 'system']).optional(),
		intent: z.enum(['discuss', 'propose']).optional(), mentionedAgents: identifiers.optional(), recipientIds: identifiers.optional(),
		fileRefs: z.array(z.record(z.unknown())).optional(), contextRefs: z.array(z.record(z.unknown())).optional(),
		inboxIntent: z.enum(['comment', 'answer', 'reply']).optional(), sourceMessageRefs: unique(exactRefs).optional(),
		authorAgentId: identifier.optional(), handoffId: identifier.optional(), parentWorkdayId: identifier.optional(),
		resultingOperationId: identifier.optional(),
	}).strict(),
	discussion_event: z.object({
		title: nonEmpty, discussion_id: nonEmpty.optional(), phase: nonEmpty.optional(), sequence: z.number().int().nonnegative().optional(),
		group_ids: strings.optional(), occurred_at: date.optional(), refs: strings.optional(),
	}),
	group: z.object({
		contract: z.literal('treeseed.group/v1'), id: nonEmpty, slug: nonEmpty.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
		name: nonEmpty, description: nonEmpty, classification: nonEmpty, aliases: strings.optional(),
		status: z.enum(['active', 'archived']).optional(),
	}),
	group_edge: z.object({
		contract: z.literal('treeseed.group-edge/v1'), id: nonEmpty, from_group_id: nonEmpty,
		to_group_id: nonEmpty, predicate: nonEmpty, propagates_membership: z.boolean().optional(),
	}),
	...auxiliaryContentSchemas,
	...agentOperationalContentSchemas,
} satisfies Record<string, z.ZodTypeAny>;

export type PortableContentModel = keyof typeof schemas;

export function isPortableContentModel(value: string): value is PortableContentModel {
	return Object.prototype.hasOwnProperty.call(schemas, value);
}

function issuePath(path: Array<string | number>) {
	return path.reduce<string>((current, segment) => typeof segment === 'number'
		? `${current}[${segment}]`
		: current ? `${current}.${segment}` : segment, '');
}

export function validateContentFrontmatter(model: PortableContentModel, value: unknown) {
	const parsed = schemas[model].safeParse(value);
	return {
		ok: parsed.success,
		data: parsed.success ? parsed.data : null,
		diagnostics: parsed.success ? [] : parsed.error.issues.map((issue) => ({
			severity: 'error' as const,
			code: `content_zod_${issue.code}`,
			field: issuePath(issue.path),
			message: issue.message,
		})),
	};
}

export function describeContentFrontmatterSchema(model: PortableContentModel) {
	return schemas[model];
}

function fieldContract(schema: z.ZodTypeAny): Record<string, unknown> {
	let current = schema;
	let required = true;
	while (current instanceof z.ZodOptional || current instanceof z.ZodNullable
		|| current instanceof z.ZodDefault || current instanceof z.ZodEffects) {
		if (current instanceof z.ZodOptional || current instanceof z.ZodDefault) required = false;
		current = current instanceof z.ZodEffects ? current.innerType()
			: current instanceof z.ZodDefault ? current.removeDefault() : current.unwrap();
	}
	const contract: Record<string, unknown> = { required };
	if (current instanceof z.ZodEnum) return { ...contract, type: 'string', values: current.options };
	if (current instanceof z.ZodLiteral) return { ...contract, type: typeof current.value, value: current.value };
	if (current instanceof z.ZodString) {
		const checks = current._def.checks as Array<{ kind: string; value?: number; regex?: RegExp }>;
		const minimum = checks.find((check) => check.kind === 'min')?.value;
		const maximum = checks.find((check) => check.kind === 'max')?.value;
		const pattern = checks.find((check) => check.kind === 'regex')?.regex?.source;
		return { ...contract, type: 'string', ...(minimum !== undefined ? { minLength: minimum } : {}),
			...(maximum !== undefined ? { maxLength: maximum } : {}), ...(pattern ? { pattern } : {}) };
	}
	if (current instanceof z.ZodNumber) return { ...contract, type: 'number' };
	if (current instanceof z.ZodBoolean) return { ...contract, type: 'boolean' };
	if (current instanceof z.ZodDate) return { ...contract, type: 'date' };
	if (current instanceof z.ZodArray) return { ...contract, type: 'array', items: fieldContract(current.element) };
	if (current instanceof z.ZodObject) return {
		...contract,
		type: 'object',
		fields: Object.fromEntries(Object.entries(current.shape).map(([name, value]) => [name, fieldContract(value as z.ZodTypeAny)])),
	};
	return { ...contract, type: current._def.typeName ?? 'unknown' };
}

/** A JSON-safe description derived directly from the canonical validation schema. */
export function describeContentFrontmatterContract(model: PortableContentModel) {
	const selected = schemas[model];
	const schema = selected instanceof z.ZodEffects ? selected.innerType() : selected;
	if (!(schema instanceof z.ZodObject)) throw new Error(`Content model ${model} is not an object schema.`);
	return {
		model,
		fields: Object.fromEntries(Object.entries(schema.shape).map(([name, value]) => [name, fieldContract(value as z.ZodTypeAny)])),
	};
}

function contractJsonSchema(contract: Record<string, unknown>): Record<string, unknown> {
	const type = contract.type;
	if (type === 'object') {
		const fields = contract.fields as Record<string, Record<string, unknown>>;
		return {
			type: 'object', additionalProperties: false,
			properties: Object.fromEntries(Object.entries(fields).map(([name, field]) => {
				const schema = contractJsonSchema(field);
				return [name, field.required === true ? schema : { anyOf: [schema, { type: 'null' }] }];
			})),
			required: Object.keys(fields),
		};
	}
	if (type === 'array') return { type: 'array', items: contractJsonSchema(contract.items as Record<string, unknown>) };
	if (contract.value !== undefined) return { type, const: contract.value };
	if (Array.isArray(contract.values)) return { type, enum: contract.values };
	if (type === 'date') return { type: 'string', format: 'date-time' };
	return Object.fromEntries(Object.entries(contract).filter(([name]) => !['required', 'fields', 'items'].includes(name)));
}

/** Strict structured-output schema generated from the canonical frontmatter validator. */
export function describeContentFrontmatterJsonSchema(model: PortableContentModel) {
	const contract = describeContentFrontmatterContract(model);
	return contractJsonSchema({ required: true, type: 'object', fields: contract.fields });
}
