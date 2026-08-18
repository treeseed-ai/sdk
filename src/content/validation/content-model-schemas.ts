import { z } from 'zod';
import { agentDefinitionSchema } from '../../agent-capacity/validation/agent-definition-schema.ts';
import { PROPOSAL_TYPE_ID_PATTERN } from '../../agent-capacity/validation/proposal-type.ts';
import {
	BOOK_SCHEMA_VERSION,
	KNOWLEDGE_PAGE_SCHEMA_VERSION,
	KNOWLEDGE_STATUSES,
	KNOWLEDGE_VISIBILITIES,
} from '../../knowledge/contracts.ts';
import { auxiliaryContentSchemas } from './auxiliary-content-schemas.ts';
import { agentOperationalContentSchemas } from './agent-operational-content-schemas.ts';
export { agentTestContentSchema, templateProductContentSchema, workdayContentSchema } from './auxiliary-content-schemas.ts';
export * from './agent-operational-content-schemas.ts';

const nonEmpty = z.string().trim().min(1);
const strings = z.array(z.string());
const date = z.coerce.date();
const lifecycleStatus = z.enum(['live', 'in progress', 'exploratory', 'planned', 'speculative']);
const contributor = nonEmpty;
const entityRefs = z.array(z.object({ model: nonEmpty, id: nonEmpty, commitSha: nonEmpty.optional() }).strict()).optional();
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

const schemas = {
	page: z.object({
		title: nonEmpty, description: nonEmpty.optional(), slug: nonEmpty.optional(), page_layout: z.enum(['article', 'bridge']).optional(),
		status: lifecycleStatus.optional(), stage: nonEmpty.optional(), audience: strings.optional(), summary: nonEmpty.optional(), updated_at: date.optional(),
	}),
	note: z.object({
		...governanceBase, author: nonEmpty.optional(), feedback_kind: z.enum(['support', 'concern', 'question', 'response']).optional(),
		entity_refs: entityRefs, about: strings.optional(), ...linked,
	}),
	question: z.object({
		...governanceBase, question_type: z.enum(['research', 'implementation', 'strategy', 'evaluation', 'knowledge-gap']).optional(),
		motivation: nonEmpty.optional(), primary_contributor: contributor.optional(), entity_refs: entityRefs, about: strings.optional(), ...linked,
	}),
	objective: z.object({
		...governanceBase, time_horizon: z.enum(['near-term', 'mid-term', 'long-term']).optional(),
		motivation: nonEmpty.optional(), primary_contributor: contributor.optional(), ...linked,
	}),
	proposal: z.object({
		...governanceBase, description: nonEmpty, date, status: lifecycleStatus, summary: nonEmpty,
		proposal_type: nonEmpty.regex(PROPOSAL_TYPE_ID_PATTERN, 'Proposal type must use lowercase kebab-case.'),
		motivation: nonEmpty, primary_contributor: contributor, related_notes: strings.optional(), evidence_refs: strings.optional(),
		plan: proposalPlanSchema.optional(), decision_dependencies: z.array(z.object({ projectId: nonEmpty, decisionId: nonEmpty }).strict()).optional(),
		...linked,
	}),
	decision: z.object({
		...governanceBase, decision_type: z.enum(['approved', 'rejected', 'deferred', 'request_changes', 'superseded']).optional(),
		rationale: nonEmpty.optional(), authority: nonEmpty.optional(), primary_contributor: contributor.optional(), related_notes: strings.optional(), ...linked,
	}),
	book: z.object({
		schemaVersion: z.literal(BOOK_SCHEMA_VERSION), id: nonEmpty, order: z.number().int().nonnegative(), slug: nonEmpty,
		title: nonEmpty, description: nonEmpty.optional(), summary: nonEmpty, status: z.enum(KNOWLEDGE_STATUSES),
		visibility: z.enum(KNOWLEDGE_VISIBILITIES), groupIds: strings.optional(), audience: strings.optional(), relatedBookIds: strings.optional(),
	}),
	knowledge: z.object({
		schemaVersion: z.literal(KNOWLEDGE_PAGE_SCHEMA_VERSION), id: nonEmpty, bookId: nonEmpty, slug: nonEmpty,
		title: nonEmpty, description: nonEmpty.optional(), summary: nonEmpty, status: z.enum(KNOWLEDGE_STATUSES),
		visibility: z.enum(KNOWLEDGE_VISIBILITIES), order: z.number().int().nonnegative().optional(), groupIds: strings.optional(),
	}),
	person: z.object({
		name: nonEmpty, description: nonEmpty.optional(), summary: nonEmpty.optional(), role: nonEmpty.optional(), affiliation: nonEmpty.optional(),
		status: lifecycleStatus.optional(), group_ids: strings.optional(), related_questions: strings.optional(), related_objectives: strings.optional(),
	}),
	agent: agentDefinitionSchema,
	discussion: z.object({
		title: nonEmpty, topic: nonEmpty.optional(), status: z.enum(['active', 'archived']).optional(), team_id: nonEmpty.optional(),
		project_id: nonEmpty.optional(), participant_ids: strings.optional(), agent_ids: strings.optional(), group_ids: strings.optional(),
		parent_workday_id: nonEmpty.optional(), legacy_status: z.enum(['open', 'resolved']).optional(), created_at: date.optional(), updated_at: date.optional(),
	}),
	discussion_message: z.object({
		title: nonEmpty, discussion_id: nonEmpty.optional(), author_id: nonEmpty.optional(), author_type: z.enum(['user', 'agent', 'system']).optional(),
		intent: z.enum(['discuss', 'propose']).optional(), reply_to: nonEmpty.optional(), source_message_refs: strings.optional(), mentioned_agents: strings.optional(),
		recipient_ids: strings.optional(),
		author_agent_id: nonEmpty.optional(), handoff_id: nonEmpty.optional(), parent_workday_id: nonEmpty.optional(), resulting_operation_id: nonEmpty.optional(),
		group_ids: strings.optional(), created_at: date.optional(),
	}),
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
	if (current instanceof z.ZodOptional) {
		required = false;
		current = current.unwrap();
	}
	if (current instanceof z.ZodNullable) current = current.unwrap();
	const contract: Record<string, unknown> = { required };
	if (current instanceof z.ZodEnum) return { ...contract, type: 'string', values: current.options };
	if (current instanceof z.ZodLiteral) return { ...contract, type: typeof current.value, value: current.value };
	if (current instanceof z.ZodString) return { ...contract, type: 'string' };
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
	const schema = schemas[model];
	return {
		model,
		fields: Object.fromEntries(Object.entries(schema.shape).map(([name, value]) => [name, fieldContract(value as z.ZodTypeAny)])),
	};
}
