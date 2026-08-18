import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSignedUserAssertion } from '../../../src/api/auth/trusted-assertion.ts';

describe('signed web user assertions', () => {
	it('binds a short-lived assertion to the authenticated user and session', () => {
		const assertion = createSignedUserAssertion({ secret: 'test-secret', userId: 'user-1',
			sessionId: 'session-1', identityId: 'identity-1', authTime: '2026-07-31T12:00:00.000Z',
			now: new Date('2026-07-31T12:01:00.000Z'), ttlSeconds: 60, nonce: 'nonce-1' });
		const [payload, signature] = assertion.split('.');
		expect(signature).toBe(createHmac('sha256', 'test-secret').update(payload).digest('base64url'));
		expect(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))).toEqual({
			userId: 'user-1', sessionId: 'session-1', identityId: 'identity-1',
			authTime: '2026-07-31T12:00:00.000Z', expiresAt: '2026-07-31T12:02:00.000Z', nonce: 'nonce-1',
		});
	});

	it('rejects an empty signing secret', () => {
		expect(() => createSignedUserAssertion({ secret: ' ', userId: 'user-1', sessionId: 'session-1',
			authTime: '2026-07-31T12:00:00.000Z' })).toThrow('assertion secret');
	});
});
