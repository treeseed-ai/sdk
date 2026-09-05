import { z } from 'zod';

const segment = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
export const secretScopeSchema = z.object({
  team: segment, project: segment, environment: segment, purpose: segment, name: segment,
}).strict();
export type SecretScope = z.infer<typeof secretScopeSchema>;
export const SECRET_CUSTODY_BACKENDS = ['openbao', 'os'] as const;
export function canonicalSecretPath(input: SecretScope): string {
  const s = secretScopeSchema.parse(input);
  return `teams/${s.team}/projects/${s.project}/environments/${s.environment}/purposes/${s.purpose}/secrets/${s.name}`;
}

export type HostedSecretOperationBinding = {
	subjectType: 'declaration' | 'plan' | 'rollback';
	subjectDigest: string;
	deploymentId: string;
	stackId: string;
	environment: 'staging' | 'production';
};


const FORBIDDEN_SECRET_KEYS = /(?:passphrase|password|plaintext|derivedKey|privateKey|apiToken|accessToken|secretValue|credentialValue)$/iu;

export function containsForbiddenPlaintextSecretMaterial(value: unknown, path = ''): string[] {
	if (!value || typeof value !== 'object') return [];
	const failures: string[] = [];
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		const nextPath = path ? `${path}.${key}` : key;
		if (FORBIDDEN_SECRET_KEYS.test(key) && typeof entry === 'string' && entry.trim()) failures.push(nextPath);
		if (entry && typeof entry === 'object') failures.push(...containsForbiddenPlaintextSecretMaterial(entry, nextPath));
	}
	return failures;
}


const digest = /^sha256:[a-f0-9]{64}$/u;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export function canonicalHostedSecretOperationBinding(input: HostedSecretOperationBinding): string {
	return JSON.stringify({
		subjectType: input.subjectType,
		subjectDigest: input.subjectDigest,
		deploymentId: input.deploymentId,
		stackId: input.stackId,
		environment: input.environment,
	});
}

export function validateHostedSecretOperationBinding(value: unknown): value is HostedSecretOperationBinding {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const binding = value as Partial<HostedSecretOperationBinding>;
	return ['declaration', 'plan', 'rollback'].includes(String(binding.subjectType))
		&& digest.test(String(binding.subjectDigest))
		&& identifier.test(String(binding.deploymentId))
		&& identifier.test(String(binding.stackId))
		&& ['staging', 'production'].includes(String(binding.environment));
}
