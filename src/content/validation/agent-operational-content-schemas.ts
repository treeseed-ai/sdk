import { z } from 'zod';
import { VALID_RELATIONS } from '../../graph/context-query-contracts.ts';

const nonEmpty = z.string().trim().min(1);
const uniqueStrings = z.array(nonEmpty).superRefine((items,context) => {
	if (new Set(items).size !== items.length) context.addIssue({ code:z.ZodIssueCode.custom,message:'Values must be unique.' });
});
const nonEmptyUniqueStrings = z.array(nonEmpty).min(1).superRefine((items,context) => {
	if (new Set(items).size !== items.length) context.addIssue({ code:z.ZodIssueCode.custom,message:'Values must be unique.' });
});
const exactRevisionRefSchema = z.object({ id:nonEmpty,revision:z.number().int().positive() }).strict();
const contextSourceSelectorSchema = z.discriminatedUnion('scope', [
	z.object({ scope:z.literal('current-project') }).strict(), z.object({ scope:z.literal('team-library') }).strict(),
	z.object({ scope:z.literal('same-team'),projectIds:uniqueStrings.default([]),projectSlugs:uniqueStrings.default([]) }).strict(),
	z.object({ scope:z.literal('shared-team'),teamId:nonEmpty,projectIds:uniqueStrings.default([]) }).strict(),
]);

export const agentContextQueryContentSchema = z.object({
	id:nonEmpty,title:nonEmpty,description:nonEmpty,revision:z.number().int().positive(),
	maturity:z.enum(['draft','validated','simulated','proven']),purpose:nonEmpty,query:nonEmpty,
	target:z.object({ kind:z.enum(['content','graph','code','mixed']),models:uniqueStrings.optional(),paths:uniqueStrings.optional() }).strict(),
	scope:z.string().startsWith('/').optional(),codeScopes:uniqueStrings.optional(),
	relations:z.array(z.enum(VALID_RELATIONS as [typeof VALID_RELATIONS[number],...typeof VALID_RELATIONS[number][]])).default(['related','references']),
	depth:z.number().int().min(0).max(3).default(1),resultLimit:z.number().int().positive(),
	contextBudget:z.object({ maxItems:z.number().int().positive(),maxCharacters:z.number().int().positive().optional() }).strict(),
	tokenBudget:z.number().int().positive(),format:z.enum(['summary','full','sources','list','brief','map']).default('summary'),
	sources:z.array(contextSourceSelectorSchema).min(1).default([{scope:'current-project'}]),
	requirement:z.enum(['required','preferred']).default('preferred'),priority:z.number().int().min(0).max(100).default(50),
	minimumBudget:z.number().int().positive().optional(),maximumBudget:z.number().int().positive().optional(),
	summarization:z.enum(['none','deterministic','provider']).default('deterministic'),
	filters:z.record(z.unknown()).default({}),
}).strict().superRefine((value,context) => {
	if (value.minimumBudget !== undefined && value.maximumBudget !== undefined && value.minimumBudget > value.maximumBudget) {
		context.addIssue({ code:z.ZodIssueCode.custom,path:['minimumBudget'],message:'minimumBudget cannot exceed maximumBudget.' });
	}
});

export const agentContextQuerySetContentSchema = z.object({
	id:nonEmpty,title:nonEmpty,description:nonEmpty,revision:z.number().int().positive(),queryRefs:z.array(exactRevisionRefSchema).min(1),
	mergePolicy:z.enum(['append','replace']).default('append'),
}).strict();

export const agentInstructionTemplateContentSchema = z.object({
	id:nonEmpty,title:nonEmpty,description:nonEmpty,revision:z.number().int().positive(),
	kind:z.enum(['plan','status','message','summary']),instructions:nonEmpty,outputSkeleton:z.string().optional(),
	variables:uniqueStrings.default([]),appliesToProfiles:uniqueStrings.default([]),
}).strict();

export const discussionTopicContentSchema = z.object({
	id:nonEmpty,title:nonEmpty,description:nonEmpty,slug:nonEmpty,
	groupIds:nonEmptyUniqueStrings,parentTopicId:nonEmpty.optional(),status:z.enum(['active','archived']).default('active'),
}).strict();

export const agentEvaluationContentSchema = z.object({
	id:nonEmpty,title:nonEmpty,description:nonEmpty.optional(),status:nonEmpty,
	teamId:nonEmpty,projectId:nonEmpty,workdayId:nonEmpty.optional(),assignmentId:nonEmpty.optional(),
	createdAt:z.coerce.date(),updatedAt:z.coerce.date().optional(),
	agentId:nonEmpty,agentDefinitionRef:exactRevisionRefSchema,activityProfile:nonEmpty,
	contextQueryRefs:z.array(exactRevisionRefSchema).default([]),contextQuerySetRefs:z.array(exactRevisionRefSchema).default([]),
	instructionTemplateRefs:z.array(exactRevisionRefSchema).default([]),evaluatorId:nonEmpty,
	outcome:z.enum(['passed','failed','needs-revision']),score:z.number().min(0).max(1).optional(),
	criteria:z.array(z.object({ id:nonEmpty,outcome:z.enum(['passed','failed','not-applicable']),evidenceRefs:uniqueStrings.default([]),notes:z.string().optional() }).strict()).min(1),
});

export const agentOperationalContentSchemas = {
	agent_context_query:agentContextQueryContentSchema,agent_context_query_set:agentContextQuerySetContentSchema,
	agent_instruction_template:agentInstructionTemplateContentSchema,discussion_topic:discussionTopicContentSchema,
	agent_evaluation:agentEvaluationContentSchema,
} satisfies Record<string,z.ZodTypeAny>;

export const AGENT_OPERATIONAL_CONTENT_COLLECTIONS = {
	agent_context_query:'agent-context-queries',agent_context_query_set:'agent-context-query-sets',
	agent_instruction_template:'agent-instruction-templates',discussion_topic:'discussion-topics',
	agent_evaluation:'agent-evaluations',
} as const;
