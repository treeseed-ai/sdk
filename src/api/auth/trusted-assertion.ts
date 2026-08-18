import { createHmac, randomUUID } from 'node:crypto';
import type { TrustedUserAssertionClaims } from '../types.ts';

export function createSignedUserAssertion(input: {
	secret: string;
	userId: string;
	sessionId: string;
	identityId?: string | null;
	authTime: string;
	now?: Date;
	ttlSeconds?: number;
	nonce?: string;
}) {
	if (!input.secret.trim()) throw new Error('A web assertion secret is required.');
	const now = input.now ?? new Date();
	const claims: TrustedUserAssertionClaims = {
		userId: input.userId,
		sessionId: input.sessionId,
		identityId: input.identityId ?? null,
		authTime: input.authTime,
		expiresAt: new Date(now.getTime() + (input.ttlSeconds ?? 300) * 1000).toISOString(),
		nonce: input.nonce ?? randomUUID(),
	};
	const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
	const signature = createHmac('sha256', input.secret).update(payload).digest('base64url');
	return `${payload}.${signature}`;
}
