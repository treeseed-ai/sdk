import { z } from 'zod';

const text = z.string().trim().min(1);
const commit = z.string().regex(/^[0-9a-f]{40}$/u);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

export const agentTeamCloneRequestSchema = z.object({
	sourceProject: text,
	targetProjects: z.array(text).min(1).optional(),
	allEligible: z.boolean().optional(),
}).strict().superRefine((value, context) => {
	if (Boolean(value.targetProjects) === (value.allEligible === true)) context.addIssue({
		code: z.ZodIssueCode.custom,
		message: 'Select targetProjects or allEligible, but not both.',
	});
});

export const agentTeamCloneDefinitionSchema = z.object({
	path: text,
	agentClass: text,
	sourceDigest: digest,
	desiredDigest: digest,
}).strict();

const projectBindingSchema = z.object({
	projectId: text,
	slug: text,
	name: text,
	repository: text,
	commit,
}).strict();

export const agentTeamClonePlanSchema = z.object({
	schemaVersion: z.literal('treeseed.agent-team-clone-plan/v1'),
	teamId: text,
	source: projectBindingSchema,
	targets: z.array(projectBindingSchema.extend({
		action: z.enum(['create', 'update', 'noop']),
		definitions: z.array(agentTeamCloneDefinitionSchema).min(1),
	})).min(1),
	digest,
}).strict();

export const agentTeamCloneReceiptSchema = z.object({
	schemaVersion: z.literal('treeseed.agent-team-clone-receipt/v1'),
	teamId: text,
	planDigest: digest,
	mutation: z.boolean(),
	noop: z.boolean(),
	targets: z.array(z.object({
		projectId: text,
		action: z.enum(['created', 'updated', 'noop']),
		repository: text,
		commit,
		definitionCount: z.number().int().positive(),
	}).strict()).min(1),
}).strict();

export type AgentTeamCloneRequest = z.infer<typeof agentTeamCloneRequestSchema>;
export type AgentTeamClonePlan = z.infer<typeof agentTeamClonePlanSchema>;
export type AgentTeamCloneReceipt = z.infer<typeof agentTeamCloneReceiptSchema>;
