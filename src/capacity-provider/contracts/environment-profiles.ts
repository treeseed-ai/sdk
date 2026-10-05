import { z } from 'zod';

const identifier = z.string().regex(/^[a-z][a-z0-9._-]{0,127}$/u);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const variableName = z.string().regex(/^[A-Z_][A-Z0-9_]*$/u);
const maximumGrantLifetimeMs = 24 * 60 * 60 * 1000;

export const providerRegistrationCodeStatusSchema = z.object({
	schemaVersion: z.literal('treeseed.provider-registration-code-status/v1'),
	teamId: z.string().min(1), generation: z.number().int().positive(), codePrefix: z.string().min(1),
	rotatedAt: z.string().datetime(),
}).strict();

export const providerRegistrationCodeReceiptSchema = z.object({
	schemaVersion: z.literal('treeseed.provider-registration-code-receipt/v1'),
	teamId: z.string().min(1), generation: z.number().int().positive(), codePrefix: z.string().min(1),
	registrationCode: z.string().min(16), rotatedAt: z.string().datetime(),
}).strict();

export const providerEnvironmentVariableDescriptorSchema = z.object({
	name: variableName, available: z.boolean(), rotatedAt: z.string().datetime().optional(),
}).strict();

export const providerEnvironmentProfileDescriptorSchema = z.object({
	schemaVersion: z.literal('treeseed.provider-environment-profile/v1'),
	id: identifier, generation: z.number().int().positive(),
	variables: z.array(providerEnvironmentVariableDescriptorSchema), updatedAt: z.string().datetime(),
}).strict().superRefine((profile, context) => {
	const names = new Set<string>();
	for (const [index, variable] of profile.variables.entries()) {
		if (names.has(variable.name)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['variables', index, 'name'], message: 'Environment variable names must be unique within a profile.' });
		names.add(variable.name);
	}
});

export const assignmentEnvironmentGrantSchema = z.object({
	schemaVersion: z.literal('treeseed.assignment-environment-grant/v1'),
	grantId: identifier, assignmentId: z.string().min(1), providerId: z.string().min(1), teamId: z.string().min(1), projectId: z.string().min(1),
	profileId: identifier, variables: z.array(variableName).min(1),
	network: z.object({ allowed: z.boolean(), destinations: z.array(z.string().min(1)) }).strict(),
	policy: z.object({
		handlerDeclarationDigest: digest, providerOfferDigest: digest, providerPermissionDigest: digest,
		teamApprovalDigest: digest, assignmentGrantDigest: digest, sandboxPolicyDigest: digest,
	}).strict(),
	issuedAt: z.string().datetime(), expiresAt: z.string().datetime(),
}).strict().superRefine((grant, context) => {
	if (new Set(grant.variables).size !== grant.variables.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['variables'], message: 'Granted environment variables must be unique.' });
	if (Date.parse(grant.expiresAt) <= Date.parse(grant.issuedAt)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'Environment grants must expire after issuance.' });
	if (Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt) > maximumGrantLifetimeMs) context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'Environment grants cannot exceed 24 hours.' });
	if (!grant.network.allowed && grant.network.destinations.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['network', 'destinations'], message: 'Denied network authority cannot declare destinations.' });
});

export type ProviderRegistrationCodeStatus = z.infer<typeof providerRegistrationCodeStatusSchema>;
export type ProviderRegistrationCodeReceipt = z.infer<typeof providerRegistrationCodeReceiptSchema>;
export type ProviderEnvironmentVariableDescriptor = z.infer<typeof providerEnvironmentVariableDescriptorSchema>;
export type ProviderEnvironmentProfileDescriptor = z.infer<typeof providerEnvironmentProfileDescriptorSchema>;
export type AssignmentEnvironmentGrant = z.infer<typeof assignmentEnvironmentGrantSchema>;
