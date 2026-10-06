import { describe, expect, it } from 'vitest';
import { identityLoginCommand } from '../../../src/operator-contracts/catalog/services/identity-commands.ts';

describe('explicit Identity login scope contract', () => {
	it('advertises an optional scope selector without changing other options', () => {
		const result = identityLoginCommand({ nodeType: 'leaf', segment: 'login', description: 'Authenticate.',
			kind: 'mutation', resultSchemaId: 'treeseed.identity.login/v1', execution: { kind: 'protocol', handlerId: 'protocol.identity' }, options: [] });
		if (result.nodeType !== 'leaf') throw new Error('Identity login must retain its leaf contract.');
		expect(result.options?.find(option => option.name === '--scope')).toEqual({
			name: '--scope', type: 'string',
			description: 'Comma-separated additional API scopes to request explicitly, such as treeseed:admin. Does not grant application permissions.',
		});
		expect(result.options?.some(option => option.name === '--issuer')).toBe(true);
	});
});
