import { z } from 'zod';

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const commit = z.string().regex(/^[0-9a-f]{40}$/u);

export const integrationComponentSchema = z.object({
	id: z.string().min(1),
	version: z.string().min(1),
	commit,
	digest,
	artifact: z.string().min(1),
}).strict();

export const integrationLockSchema = z.object({
	schemaVersion: z.literal('treeseed.platform-integration-lock/v1'),
	release: z.string().min(1),
	components: z.array(integrationComponentSchema).min(1),
	digest,
}).strict();

export const hostTemplateSchema = z.object({
	schemaVersion: z.literal('treeseed.platform-host-template/v1'),
	id: z.string().min(1),
	profiles: z.array(z.string().min(1)).min(1),
	integration: z.object({ id: z.string().min(1), digest }),
	inputs: z.array(z.object({ name: z.string().min(1), required: z.boolean(), sensitive: z.boolean().default(false) })),
}).strict();

export const projectCreatePlanSchema = z.object({
	schemaVersion: z.literal('treeseed.platform-project-create-plan/v1'),
	slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
	template: z.object({ id: z.string().min(1), version: z.string().min(1), digest }),
	team: z.string().min(1),
	repository: z.object({ owner: z.string().min(1), name: z.string().min(1), visibility: z.enum(['public', 'private']) }),
	steps: z.array(z.enum(['project', 'repository', 'template', 'library', 'inventory'])),
}).strict();

export const projectCreateReceiptSchema = projectCreatePlanSchema.omit({ schemaVersion: true }).extend({
	schemaVersion: z.literal('treeseed.platform-project-create-receipt/v1'),
	projectId: z.string().min(1),
	repositoryUrl: z.string().url(),
	libraryBindingId: z.string().min(1),
	inventoryVersion: z.number().int().positive(),
}).strict();

export const providerRegistrationRequestSchema = z.object({
	schemaVersion: z.literal('treeseed.provider-registration-request/v1'),
	requestId: z.string().uuid(),
	teamId: z.string().min(1),
	publicKey: z.string().min(32),
	capabilities: z.array(z.string().min(1)),
	state: z.enum(['pending-approval', 'approved', 'rejected', 'revoked']),
	createdAt: z.string().datetime(),
}).strict();

export const providerSessionSchema = z.object({
	schemaVersion: z.literal('treeseed.provider-session/v1'),
	providerId: z.string().min(1),
	scope: z.array(z.string().min(1)).min(1),
	issuedAt: z.string().datetime(),
	expiresAt: z.string().datetime(),
	token: z.string().min(1),
}).strict();

export const environmentProfileDescriptorSchema = z.object({
	schemaVersion: z.literal('treeseed.provider-environment-profile/v1'),
	id: z.string().min(1),
	variables: z.array(z.object({ name: z.string().regex(/^[A-Z_][A-Z0-9_]*$/u), available: z.boolean(), rotatedAt: z.string().datetime().optional() })),
}).strict();

export const assignmentEnvironmentGrantSchema = z.object({
	schemaVersion: z.literal('treeseed.assignment-environment-grant/v1'),
	assignmentId: z.string().min(1),
	profileId: z.string().min(1),
	variables: z.array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/u)),
	network: z.object({ allowed: z.boolean(), destinations: z.array(z.string()).default([]) }),
	expiresAt: z.string().datetime(),
}).strict();

export type IntegrationLock = z.infer<typeof integrationLockSchema>;
export type HostTemplate = z.infer<typeof hostTemplateSchema>;
export type ProjectCreatePlan = z.infer<typeof projectCreatePlanSchema>;
export type ProjectCreateReceipt = z.infer<typeof projectCreateReceiptSchema>;
export type ProviderRegistrationRequest = z.infer<typeof providerRegistrationRequestSchema>;
export type ProviderSession = z.infer<typeof providerSessionSchema>;
export type EnvironmentProfileDescriptor = z.infer<typeof environmentProfileDescriptorSchema>;
export type AssignmentEnvironmentGrant = z.infer<typeof assignmentEnvironmentGrantSchema>;
