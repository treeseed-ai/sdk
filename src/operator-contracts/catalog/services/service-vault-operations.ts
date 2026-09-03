import { z } from 'zod';
import { defineOperation } from '../../operation-builder.ts';

const empty = z.object({}).strict();
const none = z.undefined();
const record = z.record(z.unknown());
const teamPath = z.object({ teamId: z.string().min(1) }).strict();

function vaultOperation(
	operationId: `services.${string}`,
	method: 'DELETE' | 'GET' | 'POST' | 'PUT',
	path: `/v1/${string}`,
	pathSchema: z.ZodTypeAny,
	options: { risk?: 'ordinary' | 'credential' | 'destructive' | 'authority'; redactedPaths?: string[] } = {},
) {
	const read = method === 'GET', risk = options.risk ?? 'ordinary';
	return defineOperation({
		operationId, description: `${read ? 'Read' : 'Apply'} ${operationId}.`,
		rest: { method, path }, capability: read ? 'secrets.read' : 'secrets.write',
		...(path.includes('{') ? { parameters: `treeseed.${operationId}.parameters/v1` } : {}),
		authentication: 'oauth', oauthScopes: read ? ['treeseed:read'] : ['treeseed:projects:write'],
		kind: read ? 'read' : 'mutation', riskClass: risk, confirmation: risk === 'ordinary' ? 'never' : 'input_required',
		surfaces: ['rest'], cacheScope: read ? 'principal' : 'none', pagination: 'none',
		redactedPaths: options.redactedPaths,
	}, { path: pathSchema, query: read ? record : empty, body: read ? none : record, output: record });
}

export const SERVICE_VAULT_OPERATIONS = {
	userVaultKey: vaultOperation('services.vault.user.key.show', 'GET', '/v1/users/me/vault-key', empty),
	putUserVaultKey: vaultOperation('services.vault.user.key.put', 'PUT', '/v1/users/me/vault-key', empty,
		{ risk: 'credential', redactedPaths: ['body.encryptedPrivateKeyEnvelope'] }),
	teamVault: vaultOperation('services.vault.team.show', 'GET', '/v1/teams/{teamId}/vault', teamPath),
	initializeTeamVault: vaultOperation('services.vault.team.initialize', 'POST', '/v1/teams/{teamId}/vault', teamPath,
		{ risk: 'credential', redactedPaths: ['body.wrappedTeamVaultKey'] }),
	resetTeamVault: vaultOperation('services.vault.team.reset', 'POST', '/v1/teams/{teamId}/vault/reset', teamPath,
		{ risk: 'destructive', redactedPaths: ['body.wrappedTeamVaultKey', 'body.currentPassword'] }),
	rotateTeamVault: vaultOperation('services.vault.team.rotate', 'POST', '/v1/teams/{teamId}/vault/rotate', teamPath,
		{ risk: 'credential', redactedPaths: ['body.envelopes', 'body.grants'] }),
	vaultGrantCandidates: vaultOperation('services.vault.grant.candidates.list', 'GET', '/v1/teams/{teamId}/vault/grant-candidates', teamPath),
	createVaultGrant: vaultOperation('services.vault.grants.create', 'POST', '/v1/teams/{teamId}/vault/grants', teamPath,
		{ risk: 'credential', redactedPaths: ['body.wrappedTeamVaultKey'] }),
	deleteVaultGrant: vaultOperation('services.vault.grants.delete', 'DELETE', '/v1/teams/{teamId}/vault/grants/{grantId}',
		z.object({ teamId: z.string().min(1), grantId: z.string().min(1) }).strict(), { risk: 'destructive' }),
	vaultCredentialEnvelopes: vaultOperation('services.vault.credential.envelopes.list', 'GET',
		'/v1/teams/{teamId}/vault/credential-envelopes', teamPath),
	credentialEnvelopes: vaultOperation('services.credential.envelopes.list', 'GET',
		'/v1/teams/{teamId}/services/{connectionId}/credential-envelopes',
		z.object({ teamId: z.string().min(1), connectionId: z.string().min(1) }).strict()),
	putCredentialEnvelope: vaultOperation('services.credential.envelopes.put', 'POST',
		'/v1/teams/{teamId}/services/{connectionId}/credential-envelopes',
		z.object({ teamId: z.string().min(1), connectionId: z.string().min(1) }).strict(),
		{ risk: 'credential', redactedPaths: ['body.envelope'] }),
	createOperationLease: vaultOperation('services.operation.leases.create', 'POST', '/v1/teams/{teamId}/service-operation-leases',
		teamPath, { risk: 'authority' }),
	operationLease: vaultOperation('services.operation.leases.show', 'GET',
		'/v1/teams/{teamId}/service-operation-leases/{leaseId}',
		z.object({ teamId: z.string().min(1), leaseId: z.string().min(1) }).strict()),
	putOperationLeasePayload: vaultOperation('services.operation.leases.payload.put', 'PUT',
		'/v1/teams/{teamId}/service-operation-leases/{leaseId}/payload',
		z.object({ teamId: z.string().min(1), leaseId: z.string().min(1) }).strict(),
		{ risk: 'credential', redactedPaths: ['body.sealedPayload'] }),
} as const;

