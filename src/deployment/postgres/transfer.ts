import { z } from 'zod';

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

/** Exact future activation selection, not permission to execute caller SQL or
 * restart a source database. Deployment reattests retained source custody and
 * performs transfer only inside coordinated backup/reconciliation. */
export const postgresTransitionSelectionSchema = z.object({
  componentId: z.string().regex(/^[a-z][a-z0-9.-]{0,127}$/u),
  sourceRuntimeDigest: digest,
  targetRuntimeDigest: digest,
  topologyDigest: digest,
  configurationDigest: digest,
  allowLocaleConversion: z.boolean(),
}).strict().refine(value => value.sourceRuntimeDigest !== value.targetRuntimeDigest, 'Distinct source and target runtimes required');
export type PostgresTransitionSelection = z.infer<typeof postgresTransitionSelectionSchema>;

export const postgresTransferPreparationResultSchema = z.object({
  action: z.enum(['planned', 'prepared', 'noop']), selectionDigest: digest,
}).strict();

/** Redacted durable status: no database contents, connection settings, paths,
 * credentials or process output. A held transfer requires coordinated restore. */
export const postgresTransferRecordSchema = z.object({
  schemaVersion: z.literal('treeseed.postgres-transfer-journal/v1'),
  intentDigest: digest, restoreGeneration: z.number().int().positive().safe(), restoreDigest: digest,
  stage: z.enum(['fencing', 'export', 'restore', 'verify', 'switch', 'activate', 'accepted', 'recovery-required', 'rolled-back']),
  archiveDigest: digest.optional(),
}).strict();
export const postgresTransferStatusSchema = postgresTransferRecordSchema.nullable();
