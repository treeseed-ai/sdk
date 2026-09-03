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
	options: { risk?: 'ordinary' | 'credential' | 'destructive' | 'authority'; redactedPaths?: string[];
		body?: z.ZodTypeAny; output?: z.ZodTypeAny } = {},
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
	}, { path: pathSchema, query: read ? record : empty, body: read ? none : options.body ?? record, output: options.output ?? record });
}

const nullableRecord = record.nullable(), records = z.array(record);
const encryptedPrivateKeyEnvelope = z.object({
	version: z.literal('service-vault-v1'), algorithm: z.literal('xchacha20-poly1305-ietf'),
	kdf: z.object({ algorithm: z.literal('argon2id'), opsLimit: z.number().int().positive(), memLimit: z.number().int().positive(), salt: z.string().min(1) }).strict(),
	nonce: z.string().min(1), ciphertext: z.string().min(1), publicKey: z.string().min(1),
}).strict();
const encryptedCredentialEnvelope = z.object({
	version: z.literal('service-vault-v1'), algorithm: z.literal('xchacha20-poly1305-ietf'), ciphertext: z.string().min(1),
	nonce: z.string().min(1), wrappedKey: z.string().min(1), wrappedKeyNonce: z.string().min(1), associatedData: z.string().min(1),
	associatedDataDigest: z.string().min(1), fingerprint: z.string().min(1),
}).strict();

export const SERVICE_VAULT_OPERATIONS = {
	userVaultKey: vaultOperation('services.vault.user.key.show', 'GET', '/v1/users/me/vault-key', empty, { output: nullableRecord }),
	putUserVaultKey: vaultOperation('services.vault.user.key.put', 'PUT', '/v1/users/me/vault-key', empty,
		{ risk: 'credential', redactedPaths: ['body.encryptedPrivateKeyEnvelope'], body: z.object({ publicKey: z.string().min(1), encryptedPrivateKeyEnvelope }).strict() }),
	teamVault: vaultOperation('services.vault.team.show', 'GET', '/v1/teams/{teamId}/vault', teamPath, { output: nullableRecord }),
	initializeTeamVault: vaultOperation('services.vault.team.initialize', 'POST', '/v1/teams/{teamId}/vault', teamPath,
		{ risk: 'credential', redactedPaths: ['body.wrappedTeamVaultKey'], body: z.object({ userVaultKeyId: z.string().min(1), wrappedTeamVaultKey: z.string().min(1), encryptionVersion: z.literal('service-vault-v1') }).strict() }),
	resetTeamVault: vaultOperation('services.vault.team.reset', 'POST', '/v1/teams/{teamId}/vault/reset', teamPath,
		{ risk: 'destructive', redactedPaths: ['body.wrappedTeamVaultKey', 'body.currentPassword'], body: z.object({ userVaultKeyId: z.string().min(1), wrappedTeamVaultKey: z.string().min(1), encryptionVersion: z.literal('service-vault-v1'), confirmation: z.string().min(1), currentPassword: z.string().min(1) }).strict() }),
	rotateTeamVault: vaultOperation('services.vault.team.rotate', 'POST', '/v1/teams/{teamId}/vault/rotate', teamPath,
		{ risk: 'credential', redactedPaths: ['body.envelopes', 'body.grants'], body: z.object({ expectedKeyVersion: z.number().int().positive(),
			envelopes: z.array(z.object({ id: z.string().min(1), envelope: encryptedCredentialEnvelope }).strict()),
			grants: z.array(z.object({ userId: z.string().min(1), userVaultKeyId: z.string().min(1), wrappedTeamVaultKey: z.string().min(1) }).strict()).min(1),
		}).strict() }),
	vaultGrantCandidates: vaultOperation('services.vault.grant.candidates.list', 'GET', '/v1/teams/{teamId}/vault/grant-candidates', teamPath, { output: records }),
	createVaultGrant: vaultOperation('services.vault.grants.create', 'POST', '/v1/teams/{teamId}/vault/grants', teamPath,
		{ risk: 'credential', redactedPaths: ['body.wrappedTeamVaultKey'], body: z.object({ userId: z.string().min(1), userVaultKeyId: z.string().min(1), wrappedTeamVaultKey: z.string().min(1) }).strict() }),
	deleteVaultGrant: vaultOperation('services.vault.grants.delete', 'DELETE', '/v1/teams/{teamId}/vault/grants/{grantId}',
		z.object({ teamId: z.string().min(1), grantId: z.string().min(1) }).strict(), { risk: 'destructive' }),
	vaultCredentialEnvelopes: vaultOperation('services.vault.credential.envelopes.list', 'GET',
		'/v1/teams/{teamId}/vault/credential-envelopes', teamPath, { output: records }),
	credentialEnvelopes: vaultOperation('services.credential.envelopes.list', 'GET',
		'/v1/teams/{teamId}/services/{connectionId}/credential-envelopes',
		z.object({ teamId: z.string().min(1), connectionId: z.string().min(1) }).strict(), { output: records }),
	putCredentialEnvelope: vaultOperation('services.credential.envelopes.put', 'POST',
		'/v1/teams/{teamId}/services/{connectionId}/credential-envelopes',
		z.object({ teamId: z.string().min(1), connectionId: z.string().min(1) }).strict(),
		{ risk: 'credential', redactedPaths: ['body.envelope'], body: z.object({ definitionId: z.string().min(1), fieldKey: z.string().min(1), keyVersion: z.number().int().positive(), envelope: encryptedCredentialEnvelope }).strict() }),
	createOperationLease: vaultOperation('services.operation.leases.create', 'POST', '/v1/teams/{teamId}/service-operation-leases',
		teamPath, { risk: 'authority', body: z.object({ connectionId: z.string().min(1), capabilityType: z.string().min(1),
			credentialProfileId: z.string().min(1), purpose: z.enum(['provider-connection-validation', 'remote-git-publication',
				'workflow-dispatch', 'workflow-configuration', 'hosted-topology-plan', 'hosted-topology-apply',
				'hosted-topology-readback', 'hosted-topology-rollback']), idempotencyKey: z.string().min(1).optional(),
			resourceScope: record.optional(), hostedBinding: record.optional(), authorityRequests: z.array(record).optional(),
		}).strict() }),
	operationLease: vaultOperation('services.operation.leases.show', 'GET',
		'/v1/teams/{teamId}/service-operation-leases/{leaseId}',
		z.object({ teamId: z.string().min(1), leaseId: z.string().min(1) }).strict()),
	putOperationLeasePayload: vaultOperation('services.operation.leases.payload.put', 'PUT',
		'/v1/teams/{teamId}/service-operation-leases/{leaseId}/payload',
		z.object({ teamId: z.string().min(1), leaseId: z.string().min(1) }).strict(),
		{ risk: 'credential', redactedPaths: ['body.sealedPayload'], body: z.object({ sealedPayload: z.string().min(1) }).strict() }),
} as const;
