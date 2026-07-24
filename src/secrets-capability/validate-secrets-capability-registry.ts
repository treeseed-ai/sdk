
import { SecretsCapabilityRegistry, SecretsCapabilityRegistryProblem, SecretsCapabilityRegistryValidation, addProblem, isRecord, validateClientEncryptedEscrowMetadata, validateWritableSecretMetadata } from './secrets-capability-registry.ts';

export function validateSecretsCapabilityRegistry(
	input: unknown,
): SecretsCapabilityRegistryValidation {
	const problems: SecretsCapabilityRegistryProblem[] = [];
	if (!isRecord(input)) {
		addProblem(problems, '$', 'invalid_registry', 'Secrets capability registry must be an object.');
		return { ok: false, problems, registry: null };
	}

	const registry = input as unknown as SecretsCapabilityRegistry;
	const repositoryCredentialProviders = isRecord(input.repositoryCredentialProviders)
		? input.repositoryCredentialProviders
		: {};

	for (const key of Object.keys(repositoryCredentialProviders)) {
		if (key !== 'githubApp') {
			addProblem(
				problems,
				`repositoryCredentialProviders.${key}`,
				'unsupported_repository_credential_provider',
				'Only GitHub App repository credential providers are supported in v1.',
			);
		}
	}

	const githubApp = repositoryCredentialProviders.githubApp;
	if (githubApp !== undefined && isRecord(githubApp) && githubApp.type !== 'github-app') {
		addProblem(
			problems,
			'repositoryCredentialProviders.githubApp.type',
			'unsupported_repository_credential_provider',
			'GitHub App provider config must use type "github-app".',
		);
	}

	const secrets = Array.isArray(input.secrets) ? input.secrets : [];
	secrets.forEach((secret, index) => {
		if (!isRecord(secret)) return;
		problems.push(...validateWritableSecretMetadata(secret, `secrets.${index}`));
	});

	const operations = isRecord(input.workflowOperations) && Array.isArray(input.workflowOperations.operations)
		? input.workflowOperations.operations
		: [];
	operations.forEach((operation, index) => {
		if (!isRecord(operation)) return;
		const dispatch = isRecord(operation.dispatch) ? operation.dispatch : {};
		if (
			operation.secretBearing === true
			&& (dispatch.mode !== 'allowlisted' || dispatch.arbitraryDispatch === true)
		) {
			addProblem(
				problems,
				`workflowOperations.operations.${index}.dispatch`,
				'arbitrary_secret_workflow_dispatch',
				'Secret-bearing workflow operations must use allowlisted dispatch only.',
			);
		}
		if (operation.secretBearing === true && operation.providerSuppliedCommandsAllowed === true) {
			addProblem(
				problems,
				`workflowOperations.operations.${index}.providerSuppliedCommandsAllowed`,
				'arbitrary_secret_workflow_dispatch',
				'Secret-bearing workflow operations must not run provider-supplied commands.',
			);
		}
		const trustPolicy = isRecord(operation.trustPolicy)
			? operation.trustPolicy
			: isRecord(operation.metadata) && isRecord(operation.metadata.trustPolicy)
				? operation.metadata.trustPolicy
				: {};
		if (operation.secretBearing === true) {
			if (!Array.isArray(trustPolicy.protectedRefs) || trustPolicy.protectedRefs.length === 0) {
				addProblem(
					problems,
					`workflowOperations.operations.${index}.trustPolicy.protectedRefs`,
					'arbitrary_secret_workflow_dispatch',
					'Secret-bearing workflow operations must declare protected refs.',
				);
			}
			if (!Array.isArray(trustPolicy.allowedWorkflowFiles) || trustPolicy.allowedWorkflowFiles.length === 0) {
				addProblem(
					problems,
					`workflowOperations.operations.${index}.trustPolicy.allowedWorkflowFiles`,
					'arbitrary_secret_workflow_dispatch',
					'Secret-bearing workflow operations must declare allowlisted workflow files.',
				);
			}
			if (trustPolicy.allowUntrustedCheckout === true) {
				addProblem(
					problems,
					`workflowOperations.operations.${index}.trustPolicy.allowUntrustedCheckout`,
					'arbitrary_secret_workflow_dispatch',
					'Secret-bearing workflow operations must not run untrusted branch code.',
				);
			}
			if (trustPolicy.allowLocalActions === true) {
				addProblem(
					problems,
					`workflowOperations.operations.${index}.trustPolicy.allowLocalActions`,
					'arbitrary_secret_workflow_dispatch',
					'Secret-bearing workflow operations must not execute repository-local actions unless a future trusted action scanner is implemented.',
				);
			}
			if (trustPolicy.artifactPolicy !== undefined && !['none', 'metadata_only'].includes(String(trustPolicy.artifactPolicy))) {
				addProblem(
					problems,
					`workflowOperations.operations.${index}.trustPolicy.artifactPolicy`,
					'arbitrary_secret_workflow_dispatch',
					'Secret-bearing workflow operations may only expose no artifacts or metadata-only artifact observations in v1.',
				);
			}
			if (trustPolicy.cachePolicy !== undefined && !['disabled', 'metadata_only'].includes(String(trustPolicy.cachePolicy))) {
				addProblem(
					problems,
					`workflowOperations.operations.${index}.trustPolicy.cachePolicy`,
					'arbitrary_secret_workflow_dispatch',
					'Secret-bearing workflow operations may only disable cache use or expose metadata-only cache observations in v1.',
				);
			}
		}
	});

	const trustedExecutionSets = isRecord(input.workflowOperations) && Array.isArray(input.workflowOperations.trustedExecutionSets)
		? input.workflowOperations.trustedExecutionSets
		: [];
	trustedExecutionSets.forEach((executionSet, index) => {
		if (!isRecord(executionSet)) return;
		if (executionSet.allowProviderSuppliedCommands === true) {
			addProblem(
				problems,
				`workflowOperations.trustedExecutionSets.${index}.allowProviderSuppliedCommands`,
				'arbitrary_secret_workflow_dispatch',
				'Trusted execution sets must not allow provider-supplied commands in v1.',
			);
		}
		if (executionSet.allowLocalActions === true) {
			addProblem(
				problems,
				`workflowOperations.trustedExecutionSets.${index}.allowLocalActions`,
				'arbitrary_secret_workflow_dispatch',
				'Trusted execution sets for secret-bearing operations must not allow repository-local actions in v1.',
			);
		}
		if (executionSet.allowUntrustedCheckout === true) {
			addProblem(
				problems,
				`workflowOperations.trustedExecutionSets.${index}.allowUntrustedCheckout`,
				'arbitrary_secret_workflow_dispatch',
				'Trusted execution sets for secret-bearing operations must not allow untrusted branch checkout in v1.',
			);
		}
	});

	if (isRecord(input.capacityProviderWorkspaceDefaults)) {
		if (input.capacityProviderWorkspaceDefaults.receivesSecrets !== false) {
			addProblem(
				problems,
				'capacityProviderWorkspaceDefaults.receivesSecrets',
				'provider_secret_delegation',
				'Capacity providers must receive handles or workspace access, not customer secrets.',
			);
		}
		if (input.capacityProviderWorkspaceDefaults.directSecretDelegation === true) {
			addProblem(
				problems,
				'capacityProviderWorkspaceDefaults.directSecretDelegation',
				'provider_secret_delegation',
				'Direct provider/customer secret delegation is not supported.',
			);
		}
	}

	if (isRecord(input.clientEncryptedEscrow) && Array.isArray(input.clientEncryptedEscrow.metadataRecords)) {
		input.clientEncryptedEscrow.metadataRecords.forEach((record, index) => {
			problems.push(...validateClientEncryptedEscrowMetadata(record, `clientEncryptedEscrow.metadataRecords.${index}`));
		});
	}

	return { ok: problems.length === 0, problems, registry: registry };
}

export function assertSecretsCapabilityRegistry(input: unknown): SecretsCapabilityRegistry {
	const validation = validateSecretsCapabilityRegistry(input);
	if (!validation.ok || validation.registry === null) {
		const message = validation.problems.map((problem) => `${problem.path}: ${problem.message}`).join('\n');
		throw new Error(`Invalid Treeseed secrets capability registry.\n${message}`);
	}
	return validation.registry;
}
