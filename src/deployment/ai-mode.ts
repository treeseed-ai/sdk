import { z } from 'zod';

export const AI_MODE_INTERNAL_PATH = `${['', 'v1'].join('/')}/ai/mode`;

export const aiModeSchema = z.enum(['awake', 'sleep']);
export type AiMode = z.infer<typeof aiModeSchema>;

export const aiModeFingerprintSchema = z.object({
	inferenceRuntimeDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
	trainingRuntimeDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
}).strict();
export type AiModeFingerprint = z.infer<typeof aiModeFingerprintSchema>;

export const aiModeRequestSchema = z.object({
	schemaVersion: z.literal('treeseed.ai-mode-request/v1'),
	target: aiModeSchema,
	idempotencyKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/u),
	drainTimeoutSeconds: z.number().int().min(1).max(3_600).default(900),
}).strict();

export const aiModeTransitionStepSchema = z.object({
	id: z.enum(['close-inference', 'drain-inference', 'stop-vllm', 'start-training', 'open-training', 'close-training', 'drain-training', 'stop-training', 'start-vllm', 'warm-vllm', 'open-inference', 'rollback']),
	state: z.enum(['pending', 'running', 'succeeded', 'skipped', 'failed']),
	completedAt: z.string().datetime().nullable(),
}).strict();

export const aiModeTransitionReceiptSchema = z.object({
	schemaVersion: z.literal('treeseed.ai-mode-transition-receipt/v1'),
	transitionId: z.string().uuid(),
	idempotencyKey: z.string().min(1).max(128),
	resource: z.literal('ai-gpu'),
	requestedBy: z.enum(['operator', 'ai-lab']),
	from: aiModeSchema,
	to: aiModeSchema,
	state: z.enum(['planned', 'running', 'succeeded', 'postponed', 'rolled-back', 'degraded']),
	reason: z.enum(['active-inference', 'active-training', 'transition-failed', 'recovery-failed']).nullable(),
	fingerprint: aiModeFingerprintSchema,
	steps: z.array(aiModeTransitionStepSchema),
	startedAt: z.string().datetime(),
	completedAt: z.string().datetime().nullable(),
}).strict();

export const aiModeStatusSchema = z.object({
	schemaVersion: z.literal('treeseed.ai-mode-status/v1'),
	resource: z.literal('ai-gpu'),
	available: z.boolean(),
	mode: z.enum(['awake', 'sleep', 'transitioning-awake', 'transitioning-sleep', 'degraded', 'unavailable']),
	fingerprint: aiModeFingerprintSchema.nullable(),
	activeTransition: aiModeTransitionReceiptSchema.nullable(),
	lastReceipt: aiModeTransitionReceiptSchema.nullable(),
}).strict();

export const aiModeInternalControlSchema = z.object({
	schemaVersion: z.literal('treeseed.ai-mode-internal-control/v1'),
	transport: z.literal('mtls'),
	clientCommonName: z.literal('client-ai-lab-mode'),
	method: z.literal('POST'),
	path: z.literal(AI_MODE_INTERNAL_PATH),
	urlEnvironment: z.literal('TREESEED_AI_MODE_URL'),
	credentialFiles: z.object({
		certificateAuthority: z.literal('/run/secrets/ai-mode-ca'),
		certificate: z.literal('/run/secrets/ai-mode-client-cert'),
		privateKey: z.literal('/run/secrets/ai-mode-client-key'),
	}).strict(),
	requestSchema: z.literal('treeseed.ai-mode-request/v1'),
	receiptSchema: z.literal('treeseed.ai-mode-transition-receipt/v1'),
}).strict();

export type AiModeRequest = z.infer<typeof aiModeRequestSchema>;
export type AiModeTransitionReceipt = z.infer<typeof aiModeTransitionReceiptSchema>;
export type AiModeStatus = z.infer<typeof aiModeStatusSchema>;
