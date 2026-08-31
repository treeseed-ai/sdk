import { z } from 'zod';

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
	primaryRepository: z.string().min(1),
}).passthrough();

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
