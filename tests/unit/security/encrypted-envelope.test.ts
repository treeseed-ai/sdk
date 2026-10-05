import { describe, expect, it } from 'vitest';
import { EncryptedEnvelopeCodec, StaticEnvelopeKeyProvider } from '../../../src/security/index.ts';

const key = (value: number) => Buffer.alloc(32, value);
const aad = { purpose: 'diagnostics', teamId: 'team-1', resourceType: 'communication-trace', resourceId: 'trace-1', assignmentId: 'assignment-1', sequence: 1, eventType: 'execution.started', schemaVersion: 'trace/v1' } as const;

describe('encrypted envelope', () => {
	it('authenticates payload and bound context', () => {
		const codec = new EncryptedEnvelopeCodec(new StaticEnvelopeKeyProvider('systemd-credential', { id: 'diagnostics', version: 1, key: key(1) }));
		const envelope = codec.encrypt('protected', aad);
		expect(codec.decrypt(envelope).toString()).toBe('protected');
		expect(() => codec.decrypt({ ...envelope, aad: { ...envelope.aad, resourceId: 'trace-2' } })).toThrow(/digest verification/u);
		expect(() => codec.decrypt({ ...envelope, payload: { ...envelope.payload, authenticationTag: Buffer.alloc(16, 2).toString('base64url') } })).toThrow();
	});

	it('rewraps only the DEK under a new key generation', () => {
		const old = { id: 'diagnostics', version: 1, key: key(1) };
		const original = new EncryptedEnvelopeCodec(new StaticEnvelopeKeyProvider('systemd-credential', old)).encrypt('protected', aad);
		const rotated = new EncryptedEnvelopeCodec(new StaticEnvelopeKeyProvider('systemd-credential', { id: 'diagnostics', version: 2, key: key(2) }, [old]));
		const rewrapped = rotated.rewrap(original);
		expect(rewrapped.payload).toEqual(original.payload);
		expect(rewrapped.keyVersion).toBe(2);
		expect(rotated.decrypt(rewrapped).toString()).toBe('protected');
	});
});

