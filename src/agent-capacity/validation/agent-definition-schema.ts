import { z, type ZodError } from 'zod';
import { conditionalFields, minimumProperties, uniqueArray } from '../../content/validation/schema-constraints.ts';
import { AGENT_CONTENT_MODELS, AGENT_TOOL_GROUPS } from '../../types/agents.ts';

const identifier = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
export const agentClassSchema = z.string().min(1).max(100).regex(/^[a-z][a-z0-9-]*$/u);
const nonEmpty = z.string().trim().min(1);
const unique = <T extends z.ZodTypeAny>(item: T) => uniqueArray(z.array(item));

const dependenciesSchema = minimumProperties(z.object({
	agents: unique(agentClassSchema).optional(),
	events: unique(z.literal('workday-closing')).optional(),
}).strict(), 1, 'At least one dependency selector property is required.');

export const permissionSetSchema = z.object({
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

export const activityProfilesSchema = minimumProperties(z.object({
	planning: activityProfileSchema.optional(),
	estimating: activityProfileSchema.optional(),
	acting: activityProfileSchema.optional(),
	reviewing: activityProfileSchema.optional(),
	reporting: activityProfileSchema.optional(),
	chat: activityProfileSchema.optional(),
}).strict(), 1, 'At least one activity profile is required.');

export const agentDefinitionSchema = conditionalFields(z.object({
	schemaVersion: z.literal('treeseed.agent/v1'),
	id: identifier,
	name: nonEmpty,
	agentClass: agentClassSchema,
	purpose: nonEmpty,
	responsibilities: z.array(nonEmpty).min(1),
	capabilities: uniqueArray(z.array(identifier).min(1, 'At least one capability is required.')),
	context: z.object({ include: uniqueArray(z.array(identifier).min(1)) }).strict(),
	activityProfiles: activityProfilesSchema,
}).strict(), [{ field: 'agentClass', notEquals: 'reviewer', forbidden: { field: 'activityProfiles', key: 'reviewing' },
	path: ['activityProfiles', 'reviewing'], message: 'Only the Reviewer agent class may enable reviewing.' }]);

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
