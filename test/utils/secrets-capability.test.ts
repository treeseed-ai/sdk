import { describe, expect, it } from 'vitest';
import {
	assertTreeseedSecretsCapabilityRegistry,
	assertTreeseedClientEncryptedEscrowMetadata,
	assertTreeseedGitHubActionsEncryptedSecretDeployment,
	assertTreeseedWritableSecretMetadata,
	buildTreeseedClientEncryptedEscrowEnvelope,
	TREESEED_TREEDX_CREDENTIAL_BRIDGE_OPERATIONS,
	isApiServiceDecryptableCustomerSecret,
	isTreeseedSecretCustodyMode,
	isTreeseedV1RepositoryCredentialProvider,
	requiresClientSideSecretMaterial,
	summarizeTreeseedClientEncryptedEscrowStatus,
	summarizeTreeseedWorkflowCloudAccessDiagnostics,
	validateTreeseedClientEncryptedEscrowMetadata,
	validateTreeseedGitHubActionsEncryptedSecretDeployment,
	validateTreeseedSecretsCapabilityRegistry,
	validateTreeseedWritableSecretMetadata,
	type TreeseedSecretsCapabilityRegistry,
} from '../../src/secrets-capability.ts';
import packageJson from '../../package.json' with { type: 'json' };

function validRegistry(): TreeseedSecretsCapabilityRegistry {
	return {
		repositoryCredentialProviders: {
			githubApp: {
				type: 'github-app',
				appIdEnv: 'TREESEED_GITHUB_APP_ID',
				privateKeySecretRef: 'TREESEED_GITHUB_APP_PRIVATE_KEY',
				webhookSecretRef: 'TREESEED_GITHUB_APP_WEBHOOK_SECRET',
				requiredPermissions: {
					contents: 'write',
					metadata: 'read',
					actions: 'write',
					secrets: 'write',
					environments: 'write',
				},
			},
		},
		githubActionsSecretStore: {
			type: 'github-actions',
			defaultScope: 'environment',
			protectedEnvironments: ['production'],
			requiredSecretNamePrefix: 'TREESEED_',
			allowRepositorySecrets: true,
			allowEnvironmentSecrets: true,
		},
		workflowOperations: {
			trustedExecutionSets: [{
				id: 'trusted-release',
				repository: 'treeseed-ai/project',
				protectedRefs: ['refs/heads/main'],
				protectedEnvironments: ['production'],
				allowedWorkflowFiles: ['.github/workflows/treeseed-secret-operation.yml'],
				allowProviderSuppliedCommands: false,
			}],
			operations: [{
				id: 'repo-save',
				name: 'Repository Save',
				repository: 'treeseed-ai/project',
				workflowFile: '.github/workflows/treeseed-secret-operation.yml',
				secretBearing: true,
				trustedExecutionSetId: 'trusted-release',
				dispatch: { mode: 'allowlisted', arbitraryDispatch: false },
				secretClasses: ['repository_access'],
				providerSuppliedCommandsAllowed: false,
				trustPolicy: {
					protectedRefs: ['refs/heads/main'],
					protectedEnvironments: ['production'],
					allowedWorkflowFiles: ['.github/workflows/treeseed-secret-operation.yml'],
					artifactPolicy: 'metadata_only',
					outputObservation: 'status_only',
				},
			}],
		},
		clientEncryptedEscrow: {
			enabled: true,
			defaultAlgorithm: 'xchacha20-poly1305',
			metadataRecords: [{
				id: 'escrow-1',
				secretId: 'secret-1',
				ciphertextRef: 'local://draft-host/secret-1',
				algorithm: 'xchacha20-poly1305',
				wrappingKeyId: 'client-key-1',
				createdByClientId: 'cli',
			}],
		},
		treeDxCredentialBridge: {
			enabled: true,
			credentialProvider: 'github-app',
			allowedOperations: ['clone', 'fetch', 'save', 'commit', 'push'],
			tokenTtlSeconds: 600,
		},
		secretWrapping: {
			clientSideOnlyForCustomerProjectSecrets: true,
			teamRecoveryKeySupported: false,
		},
		repositoryAuthorityDefaults: {
			repositoryCredentialProvider: 'github-app',
			secretStore: 'github-actions',
			workflowDispatch: 'allowlisted-github-actions',
		},
		capacityProviderWorkspaceDefaults: {
			accessMode: 'full_repository_workspace',
			receivesSecrets: false,
			receivesCredentialHandles: true,
			workflowOperationHandlesOnly: true,
		},
		secrets: [{
			id: 'secret-1',
			name: 'TREESEED_REPOSITORY_WRITE',
			secretClass: 'repository_access',
			custodyMode: 'github_actions_secret_enclave',
			owner: { kind: 'customer', teamId: 'team-1', projectId: 'project-1' },
			apiDecryptable: false,
			plaintextAllowed: false,
			githubSecretTarget: {
				repository: 'treeseed-ai/project',
				environment: 'production',
				secretName: 'TREESEED_REPOSITORY_WRITE',
				scope: 'environment',
			},
		}],
	};
}

describe('secrets capability contracts', () => {
	it('accepts the v1 GitHub App and GitHub Actions secret enclave registry shape', () => {
		const registry = validRegistry();
		const validation = validateTreeseedSecretsCapabilityRegistry(registry);

		expect(validation.ok).toBe(true);
		expect(validation.problems).toEqual([]);
		expect(assertTreeseedSecretsCapabilityRegistry(registry)).toBe(registry);
		expect(packageJson.exports).toHaveProperty('./secrets-capability');
		expect(isTreeseedSecretCustodyMode('github_actions_secret_enclave')).toBe(true);
		expect(isTreeseedV1RepositoryCredentialProvider('github-app')).toBe(true);
		expect(requiresClientSideSecretMaterial('client_encrypted_escrow')).toBe(true);
		expect(TREESEED_TREEDX_CREDENTIAL_BRIDGE_OPERATIONS).toEqual(expect.arrayContaining([
			'fetch',
			'push',
			'pull_request',
			'repository_update',
		]));
		expect(assertTreeseedWritableSecretMetadata(registry.secrets![0])).toBe(registry.secrets![0]);
		expect(assertTreeseedClientEncryptedEscrowMetadata(registry.clientEncryptedEscrow!.metadataRecords![0]))
			.toBe(registry.clientEncryptedEscrow!.metadataRecords![0]);
	});

	it('accepts encrypted GitHub Actions secret deployment metadata without plaintext', () => {
		const deployment = {
			secretId: 'secret-1',
			repository: 'treeseed-ai/project',
			scope: 'environment',
			environment: 'production',
			secretName: 'TREESEED_REPOSITORY_WRITE',
			encryptedValue: 'sealed-by-github-public-key',
			keyId: 'github-key-1',
		};

		expect(validateTreeseedGitHubActionsEncryptedSecretDeployment(deployment)).toEqual([]);
		expect(assertTreeseedGitHubActionsEncryptedSecretDeployment(deployment)).toBe(deployment);
	});

	it('rejects plaintext GitHub Actions secret deployment payloads', () => {
		expect(validateTreeseedGitHubActionsEncryptedSecretDeployment({
			repository: 'treeseed-ai/project',
			scope: 'environment',
			environment: 'production',
			secretName: 'TREESEED_REPOSITORY_WRITE',
			encryptedValue: 'sealed-by-github-public-key',
			keyId: 'github-key-1',
			secretValue: 'do-not-store',
		})).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: 'plaintext_escrow_material' }),
		]));
	});

	it('rejects non-GitHub repository credential providers in v1', () => {
		const validation = validateTreeseedSecretsCapabilityRegistry({
			...validRegistry(),
			repositoryCredentialProviders: {
				githubApp: { type: 'github-app' },
				gitlab: { type: 'gitlab' },
				bitbucket: { type: 'bitbucket' },
				sshDeployKey: { type: 'ssh-deploy-key' },
			},
		});

		expect(validation.ok).toBe(false);
		expect(validation.problems.map((problem) => problem.code)).toEqual([
			'unsupported_repository_credential_provider',
			'unsupported_repository_credential_provider',
			'unsupported_repository_credential_provider',
		]);
		expect(isTreeseedV1RepositoryCredentialProvider('gitlab')).toBe(false);
	});

	it('rejects customer project secrets that are API-service-decryptable', () => {
		const secret = {
			id: 'secret-1',
			name: 'PRIVATE_REPO_WRITE',
			secretClass: 'repository_access',
			custodyMode: 'github_actions_secret_enclave',
			owner: { kind: 'customer', projectId: 'project-1' },
			apiDecryptable: true,
		};
		const validation = validateTreeseedSecretsCapabilityRegistry({
			...validRegistry(),
			secrets: [secret],
		});

		expect(isApiServiceDecryptableCustomerSecret(secret)).toBe(true);
		expect(validateTreeseedWritableSecretMetadata(secret)).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: 'api_decryptable_customer_secret' }),
		]));
		expect(validation.ok).toBe(false);
		expect(validation.problems).toContainEqual(expect.objectContaining({
			code: 'api_decryptable_customer_secret',
			path: 'secrets.0.apiDecryptable',
		}));
	});

	it('keeps client-encrypted escrow metadata ciphertext-only', () => {
		const validation = validateTreeseedSecretsCapabilityRegistry({
			...validRegistry(),
			clientEncryptedEscrow: {
				enabled: true,
				metadataRecords: [{
					id: 'escrow-1',
					secretId: 'secret-1',
					ciphertextRef: 'local://draft-host/secret-1',
					algorithm: 'xchacha20-poly1305',
					wrappingKeyId: 'client-key-1',
					plaintext: 'do-not-store-this',
				}],
			},
		});

		expect(validation.ok).toBe(false);
		expect(validateTreeseedClientEncryptedEscrowMetadata({
			id: 'escrow-1',
			secretId: 'secret-1',
			ciphertextRef: 'local://draft-host/secret-1',
			algorithm: 'xchacha20-poly1305',
			wrappingKeyId: 'client-key-1',
			rawSecret: 'do-not-store-this',
		})).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: 'plaintext_escrow_material' }),
		]));
		expect(validation.problems).toContainEqual(expect.objectContaining({
			code: 'plaintext_escrow_material',
			path: 'clientEncryptedEscrow.metadataRecords.0',
		}));
	});

	it('accepts client-encrypted escrow envelopes with KDF and cipher metadata', () => {
		const envelope = {
			id: 'escrow-1',
			secretId: 'secret-1',
			ciphertext: 'base64-ciphertext',
			ciphertextRef: 'api://escrow/escrow-1',
			algorithm: 'xchacha20-poly1305',
			nonce: 'base64-nonce',
			salt: 'base64-salt',
			kdf: 'argon2id',
			kdfParams: { memoryKiB: 65536, iterations: 3, parallelism: 1 },
			wrappingKeyId: 'client-key-1',
			encryptionVersion: 'v1',
			createdByClientId: 'cli',
			expiresAt: '2026-07-17T00:00:00.000Z',
			deploymentIntent: {
				targetMode: 'github_actions_secret_enclave',
				repository: 'treeseed-ai/project',
				environment: 'production',
				secretName: 'TREESEED_PROJECT_SECRET',
			},
			metadata: { purpose: 'draft-host-config' },
		};

		expect(validateTreeseedClientEncryptedEscrowMetadata(envelope)).toEqual([]);
		expect(buildTreeseedClientEncryptedEscrowEnvelope(envelope)).toStrictEqual(envelope);
	});

	it('rejects passphrases and derived keys in client-encrypted escrow envelopes', () => {
		expect(validateTreeseedClientEncryptedEscrowMetadata({
			id: 'escrow-1',
			secretId: 'secret-1',
			ciphertext: 'base64-ciphertext',
			ciphertextRef: 'api://escrow/escrow-1',
			algorithm: 'xchacha20-poly1305',
			nonce: 'base64-nonce',
			salt: 'base64-salt',
			kdf: 'argon2id',
			kdfParams: { memoryKiB: 65536 },
			wrappingKeyId: 'client-key-1',
			encryptionVersion: 'v1',
			passphrase: 'do-not-send',
		})).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: 'plaintext_escrow_material' }),
		]));
		expect(validateTreeseedClientEncryptedEscrowMetadata({
			id: 'escrow-1',
			secretId: 'secret-1',
			ciphertext: 'base64-ciphertext',
			ciphertextRef: 'api://escrow/escrow-1',
			algorithm: 'xchacha20-poly1305',
			nonce: 'base64-nonce',
			salt: 'base64-salt',
			kdf: 'argon2id',
			kdfParams: { derivedKey: 'do-not-send' },
			wrappingKeyId: 'client-key-1',
			encryptionVersion: 'v1',
		})).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: 'plaintext_escrow_material' }),
		]));
	});

	it('summarizes escrow status without revealing ciphertext', () => {
		expect(summarizeTreeseedClientEncryptedEscrowStatus({
			status: 'active',
			expiresAt: '2026-01-01T00:00:00.000Z',
		}, new Date('2026-06-17T00:00:00.000Z'))).toMatchObject({
			status: 'reentry_required',
			escrowed: true,
			expired: true,
			reentryRequired: true,
		});
		expect(summarizeTreeseedClientEncryptedEscrowStatus({
			status: 'migrated',
			migratedTo: 'github_actions_secret_enclave',
		}, new Date('2026-06-17T00:00:00.000Z'))).toMatchObject({
			status: 'migrated',
			escrowed: false,
			migrated: true,
			migrationTarget: 'github_actions_secret_enclave',
		});
		expect(summarizeTreeseedClientEncryptedEscrowStatus({
			status: 'tombstoned',
			tombstonedAt: '2026-06-17T00:00:00.000Z',
		})).toMatchObject({
			status: 'tombstoned',
			escrowed: false,
			tombstoned: true,
		});
	});

	it('rejects arbitrary secret-bearing workflow dispatch and direct provider secret delegation', () => {
		const validation = validateTreeseedSecretsCapabilityRegistry({
			...validRegistry(),
			workflowOperations: {
				trustedExecutionSets: [{
					id: 'unsafe',
					repository: 'treeseed-ai/project',
					protectedRefs: ['refs/heads/main'],
					allowedWorkflowFiles: ['.github/workflows/unsafe.yml'],
					allowProviderSuppliedCommands: true,
				}],
				operations: [{
					id: 'unsafe-dispatch',
					name: 'Unsafe Dispatch',
					repository: 'treeseed-ai/project',
					workflowFile: '.github/workflows/unsafe.yml',
					secretBearing: true,
					trustedExecutionSetId: 'unsafe',
					dispatch: { mode: 'arbitrary', arbitraryDispatch: true },
					providerSuppliedCommandsAllowed: true,
				}],
			},
			capacityProviderWorkspaceDefaults: {
				accessMode: 'full_repository_workspace',
				receivesSecrets: true,
				receivesCredentialHandles: true,
				directSecretDelegation: true,
			},
		});

		expect(validation.ok).toBe(false);
		expect(validation.problems.map((problem) => problem.code)).toEqual([
			'arbitrary_secret_workflow_dispatch',
			'arbitrary_secret_workflow_dispatch',
			'arbitrary_secret_workflow_dispatch',
			'arbitrary_secret_workflow_dispatch',
			'arbitrary_secret_workflow_dispatch',
			'provider_secret_delegation',
			'provider_secret_delegation',
		]);
	});

	it('rejects secret-bearing workflow policies that can run untrusted code or leak outputs', () => {
		const validation = validateTreeseedSecretsCapabilityRegistry({
			...validRegistry(),
			workflowOperations: {
				trustedExecutionSets: [{
					id: 'unsafe-actions',
					repository: 'treeseed-ai/project',
					protectedRefs: ['refs/heads/main'],
					allowedWorkflowFiles: ['.github/workflows/unsafe.yml'],
					allowProviderSuppliedCommands: false,
					allowLocalActions: true,
					allowUntrustedCheckout: true,
				}],
				operations: [{
					id: 'unsafe-actions',
					name: 'Unsafe Actions',
					repository: 'treeseed-ai/project',
					workflowFile: '.github/workflows/unsafe.yml',
					secretBearing: true,
					trustedExecutionSetId: 'unsafe-actions',
					dispatch: { mode: 'allowlisted', arbitraryDispatch: false },
					providerSuppliedCommandsAllowed: false,
					trustPolicy: {
						protectedRefs: ['refs/heads/main'],
						protectedEnvironments: ['production'],
						allowedWorkflowFiles: ['.github/workflows/unsafe.yml'],
						allowUntrustedCheckout: true,
						allowLocalActions: true,
						artifactPolicy: 'allowlisted',
						cachePolicy: 'allowlisted',
					},
				}],
			},
		});

		expect(validation.ok).toBe(false);
		expect(validation.problems.map((problem) => problem.path)).toEqual(expect.arrayContaining([
			'workflowOperations.operations.0.trustPolicy.allowUntrustedCheckout',
			'workflowOperations.operations.0.trustPolicy.allowLocalActions',
			'workflowOperations.operations.0.trustPolicy.artifactPolicy',
			'workflowOperations.operations.0.trustPolicy.cachePolicy',
			'workflowOperations.trustedExecutionSets.0.allowLocalActions',
			'workflowOperations.trustedExecutionSets.0.allowUntrustedCheckout',
		]));
	});

	it('reports OIDC-preferred cloud access diagnostics without failing otherwise valid workflow policy', () => {
		const operation = validRegistry().workflowOperations?.operations?.[0];
		const diagnostics = summarizeTreeseedWorkflowCloudAccessDiagnostics({
			...operation!,
			trustPolicy: {
				...operation!.trustPolicy,
				cloudAccess: {
					longLivedSecrets: true,
					oidcPreferred: false,
				},
			},
		});

		expect(diagnostics).toEqual([expect.objectContaining({
			code: 'oidc_preferred_for_cloud_access',
			severity: 'warning',
		})]);
	});
});
