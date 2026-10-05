import { describe, expect, it } from 'vitest';
import { aiModeInternalControlSchema, aiModeRequestSchema, aiModeStatusSchema, aiModeTransitionReceiptSchema } from '../../../src/deployment/ai-mode.js';

const digest = `sha256:${'a'.repeat(64)}`;

describe('AI GPU mode contracts', () => {
	it('accepts only the fixed awake and sleep request surface', () => {
		expect(aiModeRequestSchema.parse({ schemaVersion: 'treeseed.ai-mode-request/v1', target: 'sleep', idempotencyKey: 'cycle-1' }).drainTimeoutSeconds).toBe(900);
		expect(() => aiModeRequestSchema.parse({ schemaVersion: 'treeseed.ai-mode-request/v1', target: 'training', idempotencyKey: 'cycle-1' })).toThrow();
	});

	it('binds durable receipts and the scoped mTLS lab interface', () => {
		const receipt = aiModeTransitionReceiptSchema.parse({ schemaVersion: 'treeseed.ai-mode-transition-receipt/v1', transitionId: crypto.randomUUID(), idempotencyKey: 'cycle-1', resource: 'ai-gpu', requestedBy: 'ai-lab', from: 'awake', to: 'sleep', state: 'succeeded', reason: null, fingerprint: { inferenceRuntimeDigest: digest, trainingRuntimeDigest: digest }, steps: [], startedAt: new Date().toISOString(), completedAt: new Date().toISOString() });
		expect(aiModeStatusSchema.parse({ schemaVersion: 'treeseed.ai-mode-status/v1', resource: 'ai-gpu', available: true, mode: 'sleep', fingerprint: receipt.fingerprint, activeTransition: null, lastReceipt: receipt }).mode).toBe('sleep');
		expect(aiModeInternalControlSchema.parse({ schemaVersion: 'treeseed.ai-mode-internal-control/v1', transport: 'mtls', clientCommonName: 'client-ai-lab-mode', method: 'POST', path: '/v1/ai/mode', urlEnvironment: 'TREESEED_AI_MODE_URL', credentialFiles: { certificateAuthority: '/run/secrets/ai-mode-ca', certificate: '/run/secrets/ai-mode-client-cert', privateKey: '/run/secrets/ai-mode-client-key' }, requestSchema: 'treeseed.ai-mode-request/v1', receiptSchema: 'treeseed.ai-mode-transition-receipt/v1' }).transport).toBe('mtls');
	});
});
