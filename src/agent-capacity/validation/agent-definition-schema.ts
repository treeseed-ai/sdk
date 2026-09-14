import { z, type ZodError } from 'zod';
import { AGENT_CONTENT_MODELS, AGENT_TOOL_GROUPS } from '../../types/agents.ts';

const identifier = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const agentClass = z.string().trim().min(1).max(100).regex(/^[a-z][a-z0-9-]*$/u);
const nonEmpty = z.string().trim().min(1);
const unique = <T extends z.ZodTypeAny>(item: T) => z.array(item).superRefine((items, context) => {
	if (new Set(items.map((value) => JSON.stringify(value))).size !== items.length) {
		context.addIssue({ code: z.ZodIssueCode.custom, message: 'Values must be unique.' });
	}
});

const dependenciesSchema = z.object({
	agents: unique(agentClass).optional(),
	events: unique(z.literal('workday-closing')).optional(),
}).strict().refine((value) => Boolean(value.agents?.length || value.events?.length), {
	message: 'At least one dependency selector is required.',
});

const permissionSetSchema = z.object({
	content: z.object({
		read: unique(z.enum(AGENT_CONTENT_MODELS)),
		write: unique(z.enum(AGENT_CONTENT_MODELS)),
	}).strict(),
	tools: unique(z.enum(AGENT_TOOL_GROUPS)),
}).strict();

const promptSchema = z.object({
	system: z.string().trim().min(20),
	instructions: z.array(nonEmpty).optional(),
}).strict();

export const activityProfileSchema = z.object({
	handler: identifier,
	dependsOn: dependenciesSchema.optional(),
	permissions: permissionSetSchema,
	prompt: promptSchema,
	additionalContext: unique(identifier).optional(),
	parameters: z.record(z.unknown()).optional(),
}).strict();

export const activityProfilesSchema = z.object({
	planning: activityProfileSchema.optional(),
	estimating: activityProfileSchema.optional(),
	acting: activityProfileSchema.optional(),
	reviewing: activityProfileSchema.optional(),
	reporting: activityProfileSchema.optional(),
	chat: activityProfileSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
	message: 'At least one activity profile is required.',
});

export const agentDefinitionSchema = z.object({
	schemaVersion: z.literal('treeseed.agent/v1'),
	id: identifier,
	name: nonEmpty,
	agentClass,
	purpose: nonEmpty,
	responsibilities: z.array(nonEmpty).min(1),
	capabilities: unique(identifier).refine((value) => value.length > 0, 'At least one capability is required.'),
	context: z.object({ include: unique(identifier).refine((value) => value.length > 0) }).strict(),
	activityProfiles: activityProfilesSchema,
}).strict().superRefine((agent, context) => {
	if (agent.agentClass !== 'reviewer' && agent.activityProfiles.reviewing) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ['activityProfiles', 'reviewing'],
			message: 'Only the Reviewer agent class may enable reviewing.',
		});
	}
});

function issuePath(path: PropertyKey[]): string {
	return path.reduce<string>((current, segment) => typeof segment === 'number'
		? `${current}[${segment}]`
		: current ? `${current}.${String(segment)}` : String(segment), '');
}

export function diagnosticsFromZod(error: ZodError, prefix = '') {
	return error.issues.map((issue) => {
		const suffix = issuePath(issue.path);
		return {
			code: `agent_schema_${issue.code}`,
			path: prefix && suffix ? `${prefix}.${suffix}` : prefix || suffix,
			message: issue.message,
		};
	});
}

export function validateAgentDefinitionModel(value: unknown) {
	const parsed = agentDefinitionSchema.safeParse(value);
	return parsed.success
		? { ok: true, diagnostics: [], data: parsed.data }
		: { ok: false, diagnostics: diagnosticsFromZod(parsed.error), data: null };
}
