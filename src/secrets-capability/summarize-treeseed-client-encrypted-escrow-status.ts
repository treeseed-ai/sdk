
import { TreeseedClientEncryptedEscrowEnvelopeInput, TreeseedClientEncryptedEscrowStatusSummary } from './treeseed-secret-custody-modes.ts';
import { TreeseedGitHubActionsEncryptedSecretDeployment, TreeseedWorkflowOperationContract } from './treeseed-git-hub-app-token-issuance-record.ts';
import { TreeseedSecretsCapabilityRegistryProblem, addProblem, containsTreeseedPlaintextSecretMaterial, isRecord } from './treeseed-secrets-capability-registry.ts';

export function summarizeTreeseedClientEncryptedEscrowStatus(
	input: Pick<TreeseedClientEncryptedEscrowEnvelopeInput, 'status' | 'expiresAt' | 'migratedTo' | 'tombstonedAt'>,
	now: Date = new Date(),
): TreeseedClientEncryptedEscrowStatusSummary {
	const expired = Boolean(input.expiresAt && Date.parse(input.expiresAt) <= now.getTime());
	const tombstoned = Boolean(input.tombstonedAt) || input.status === 'tombstoned';
	const migrated = Boolean(input.migratedTo) || input.status === 'migrated';
	const reentryRequired = input.status === 'reentry_required' || (expired && !migrated && !tombstoned);
	const status = tombstoned
		? 'tombstoned'
		: migrated
			? 'migrated'
			: reentryRequired
				? 'reentry_required'
				: expired
					? 'expired'
					: input.status ?? 'active';
	return {
		status,
		escrowed: !migrated && !tombstoned,
		migrated,
		expired,
		tombstoned,
		reentryRequired,
		migrationTarget: input.migratedTo ?? null,
		expiresAt: input.expiresAt ?? null,
	};
}

export function summarizeTreeseedWorkflowCloudAccessDiagnostics(
	operation: Pick<TreeseedWorkflowOperationContract, 'secretBearing' | 'trustPolicy' | 'metadata'>,
): Array<{ code: 'oidc_preferred_for_cloud_access'; severity: 'warning'; message: string }> {
	const trustPolicy = isRecord(operation.trustPolicy)
		? operation.trustPolicy
		: isRecord(operation.metadata) && isRecord(operation.metadata.trustPolicy)
			? operation.metadata.trustPolicy
			: {};
	const cloudAccess = isRecord(trustPolicy.cloudAccess) ? trustPolicy.cloudAccess : {};
	if (operation.secretBearing === true && cloudAccess.longLivedSecrets === true && cloudAccess.oidcPreferred !== true) {
		return [{
			code: 'oidc_preferred_for_cloud_access',
			severity: 'warning',
			message: 'Secret-bearing cloud workflows should prefer GitHub OIDC over long-lived cloud API keys when the target cloud supports it.',
		}];
	}
	return [];
}

export function validateTreeseedGitHubActionsEncryptedSecretDeployment(
	input: unknown,
	path = '$',
): TreeseedSecretsCapabilityRegistryProblem[] {
	const problems: TreeseedSecretsCapabilityRegistryProblem[] = [];
	if (!isRecord(input)) {
		addProblem(problems, path, 'invalid_registry', 'GitHub Actions encrypted secret deployment must be an object.');
		return problems;
	}
	if (containsTreeseedPlaintextSecretMaterial(input)) {
		addProblem(
			problems,
			path,
			'plaintext_escrow_material',
			'GitHub Actions secret deployment payloads must contain GitHub-encrypted values only.',
		);
	}
	for (const key of ['repository', 'scope', 'secretName', 'encryptedValue', 'keyId']) {
		if (typeof input[key] !== 'string' || !String(input[key]).trim()) {
			addProblem(
				problems,
				`${path}.${key}`,
				'invalid_secret_custody_target',
				`GitHub Actions encrypted secret deployment must include ${key}.`,
			);
		}
	}
	if (input.scope === 'environment' && (typeof input.environment !== 'string' || !input.environment.trim())) {
		addProblem(
			problems,
			`${path}.environment`,
			'invalid_secret_custody_target',
			'GitHub environment secret deployment must include an environment.',
		);
	}
	return problems;
}

export function assertTreeseedGitHubActionsEncryptedSecretDeployment(input: unknown): TreeseedGitHubActionsEncryptedSecretDeployment {
	const problems = validateTreeseedGitHubActionsEncryptedSecretDeployment(input);
	if (problems.length > 0) {
		const message = problems.map((problem) => `${problem.path}: ${problem.message}`).join('\n');
		throw new Error(`Invalid Treeseed GitHub Actions encrypted secret deployment.\n${message}`);
	}
	return input as TreeseedGitHubActionsEncryptedSecretDeployment;
}
