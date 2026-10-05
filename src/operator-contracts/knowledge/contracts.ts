import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);
const uniqueStrings = (minimum=0) => z.array(nonEmpty).min(minimum).superRefine((values, context) => {
	if (new Set(values).size !== values.length) context.addIssue({ code:z.ZodIssueCode.custom,message:'Values must be unique.' });
});

export const knowledgeShareOperationSchema = z.enum(['read','query','context','graph']);
export const knowledgeShareGrantInputSchema = z.object({
	targetTeamId:nonEmpty,projectIds:uniqueStrings(1),contentModels:uniqueStrings().default([]),paths:uniqueStrings(1).default(['**']),
	operations:z.array(knowledgeShareOperationSchema).min(1).superRefine((values, context) => {
		if (new Set(values).size !== values.length) context.addIssue({ code:z.ZodIssueCode.custom,message:'Operations must be unique.' });
	}).default(['read','query','context','graph']),expiresAt:z.string().datetime({ offset:true }).nullable().default(null),
}).strict();
export const knowledgeShareSchema = knowledgeShareGrantInputSchema.extend({
	schemaVersion:z.literal('treeseed.knowledge-share/v1'),id:nonEmpty,sourceTeamId:nonEmpty,status:z.enum(['active','revoked','expired']),
	createdAt:z.string().datetime({ offset:true }),updatedAt:z.string().datetime({ offset:true }),revokedAt:z.string().datetime({ offset:true }).nullable(),
}).strict().superRefine((value, context) => {
	if (value.sourceTeamId === value.targetTeamId) context.addIssue({ code:z.ZodIssueCode.custom,path:['targetTeamId'],message:'Knowledge shares are only for another team.' });
});
export const teamKnowledgeRequestSchema = z.object({
	projectIds:uniqueStrings().default([]),projectSlugs:uniqueStrings().default([]),
	sharedSources:z.array(z.object({ teamId:nonEmpty,projectIds:uniqueStrings().default([]) }).strict()).default([]),request:z.record(z.unknown()),
}).strict();
export type KnowledgeShare = z.infer<typeof knowledgeShareSchema>;
export type KnowledgeShareGrantInput = z.infer<typeof knowledgeShareGrantInputSchema>;
export type TeamKnowledgeRequest = z.infer<typeof teamKnowledgeRequestSchema>;
