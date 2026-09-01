import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const contextSourceSelectorSchema = z.discriminatedUnion('scope', [
	z.object({ scope:z.literal('current-project') }).strict(),
	z.object({ scope:z.literal('team-library') }).strict(),
	z.object({ scope:z.literal('same-team'), projectIds:z.array(nonEmpty).default([]), projectSlugs:z.array(nonEmpty).default([]) }).strict(),
	z.object({ scope:z.literal('shared-team'), teamId:nonEmpty, projectIds:z.array(nonEmpty).default([]) }).strict(),
]);

export const assignmentContextSourceSchema = z.object({
	id:nonEmpty, layer:z.enum(['core','agent','activity','live','tool']), kind:nonEmpty,
	teamId:nonEmpty, projectId:nonEmpty, path:nonEmpty.nullable(), digest,
	disposition:z.enum(['included','summarized','omitted','failed']), required:z.boolean(),
	measurement:z.object({ unit:z.enum(['tokens','bytes','items']), amount:z.number().int().nonnegative(), provenance:nonEmpty }).strict(),
	reason:z.string().nullable(), metadata:z.record(z.unknown()).default({}),
}).strict();

export const assignmentContextPackSchema = z.object({
	schemaVersion:z.literal('treeseed.assignment-context-pack/v1'), assignmentId:nonEmpty,
	capacity:z.object({ mode:z.enum(['bounded','unbounded']), measurement:z.enum(['tokens','bytes','items']).nullable(),
		defaultInitial:z.number().int().positive().nullable(), maximum:z.number().int().positive().nullable(),
		reservedOutput:z.number().int().nonnegative().nullable(),transportPayloadBytes:z.number().int().positive(),
		measurementProvenance:z.object({provider:nonEmpty,implementation:nonEmpty,version:z.string().nullable()}).strict() }).strict(),
	totals:z.object({ tokens:z.number().int().nonnegative(), bytes:z.number().int().nonnegative(), items:z.number().int().nonnegative() }).strict(),
	sources:z.array(assignmentContextSourceSchema), digest,
}).strict();

export type ContextSourceSelector = z.infer<typeof contextSourceSelectorSchema>;
export type AssignmentContextSource = z.infer<typeof assignmentContextSourceSchema>;
export type AssignmentContextPack = z.infer<typeof assignmentContextPackSchema>;
