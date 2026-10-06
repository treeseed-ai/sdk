import { z } from 'zod';
import { leaseSchema } from '../agent-capacity/contracts/capacity/assignments/agent-execution.ts';

const identifier = leaseSchema.shape.id;
const slug = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/u);
export const repositoryBindingSchema = z.object({ repository: z.string().min(1), defaultBranch: z.string().min(1) }).strict();
export const treeDxBindingSchema = z.object({ repository: z.string().min(1), collection: z.string().min(1), protectedRef: z.string().min(1) }).strict();
/** Durable portfolio identity, distinct from installer inventory selection. */
export const teamRecordSchema = z.object({ schemaVersion: z.literal('treeseed.team/v1'), id: identifier,
	slug, name: z.string().min(1), active: z.boolean() }).strict();
export const projectRecordSchema = z.object({ schemaVersion: z.literal('treeseed.project/v1'), id: identifier,
	teamId: identifier, slug, name: z.string().min(1), source: repositoryBindingSchema, treeDx: treeDxBindingSchema, active: z.boolean() }).strict();
export type TeamRecord = z.infer<typeof teamRecordSchema>;
export type ProjectRecord = z.infer<typeof projectRecordSchema>;

export const repositorySchema = z.object({
	key: z.string().min(1),
	project: z.string().min(1),
	role: z.enum(['primary', 'library', 'fixture']),
	gitUrl: z.string().min(1),
	defaultBranch: z.string().min(1).default('main'),
	repositoryPolicy: z.object({ stagingBranch: z.string().min(1).optional() }).passthrough().optional(),
}).passthrough();

export const projectSchema = z.object({
	key: z.string().min(1),
	slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
	kind: z.string().optional(),
	primaryRepository: z.string().min(1).optional(),
	libraryRepository: z.string().min(1).optional(),
}).passthrough().superRefine((project, context) => {
	if (!project.primaryRepository && project.kind !== 'content') context.addIssue({ code: 'custom', path: ['primaryRepository'], message: 'Software projects require a primary source repository.' });
	if (project.kind === 'content' && !project.libraryRepository) context.addIssue({ code: 'custom', path: ['libraryRepository'], message: 'Content projects require a library repository.' });
});

export const inventorySchema = z.object({
	schemaVersion: z.string().min(1),
	resources: z.object({
		projects: z.array(projectSchema),
		repositories: z.array(repositorySchema),
	}).passthrough(),
}).passthrough();

export const profileSchema = z.object({
	schemaVersion: z.literal('treeseed.platform-profile/v1'),
	id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
	extends: z.array(z.string()).default([]),
	sources: z.object({ projects: z.array(z.string()).default([]) }).default({ projects: [] }),
	runtime: z.object({ targets: z.array(z.string()).default([]) }).passthrough().default({ targets: [] }),
}).passthrough();

export const worksetSelectionSchema = z.object({
	profiles: z.array(z.string()).default([]),
	projects: z.array(z.string()).default([]),
	exclude: z.array(z.string()).default([]),
});

export const worksetEntrySchema = z.object({
	project: z.string(),
	repository: z.string(),
	gitUrl: z.string(),
	branch: z.string(),
	commit: z.string().regex(/^[0-9a-f]{40}$/u),
	path: z.string(),
	action: z.enum(['clone', 'fast-forward', 'noop', 'blocked']),
	blockers: z.array(z.string()).default([]),
});

export const worksetPlanSchema = z.object({
	schemaVersion: z.literal('treeseed.platform-workset-plan/v1'),
	root: z.string(),
	inventoryPath: z.string(),
	inventoryDigest: z.string(),
	selection: worksetSelectionSchema,
	entries: z.array(worksetEntrySchema),
	ok: z.boolean(),
});

export const worksetReceiptSchema = z.object({
	schemaVersion: z.literal('treeseed.platform-workset-receipt/v1'),
	planDigest: z.string(),
	inventoryDigest: z.string(),
	entries: z.array(worksetEntrySchema.omit({ action: true, blockers: true }).extend({ action: z.enum(['clone', 'fast-forward', 'noop']) })),
});

export interface PlatformDiagnostic { code: string; path: string; message: string }
export type Inventory = z.infer<typeof inventorySchema>;
export type PlatformProfile = z.infer<typeof profileSchema>;
export type WorksetSelection = z.infer<typeof worksetSelectionSchema>;
export type WorksetEntry = z.infer<typeof worksetEntrySchema>;
export type WorksetPlan = z.infer<typeof worksetPlanSchema>;
export type WorksetReceipt = z.infer<typeof worksetReceiptSchema>;
