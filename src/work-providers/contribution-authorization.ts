export const TREESEED_CONTRIBUTION_GRANT_VERSION = 'treeseed.contribution-grant/v1' as const;
export const TREESEED_AGENT_CONTRIBUTION_ATTESTATION_VERSION = 'treeseed.agent-contribution-attestation/v1' as const;
export const TREESEED_AGENT_CONTRIBUTION_CAPABILITY = 'contribution_attestation' as const;
export const TREESEED_CONTRIBUTION_BLOCK_START = '<!-- treeseed:contribution-attestation:start -->';
export const TREESEED_CONTRIBUTION_BLOCK_END = '<!-- treeseed:contribution-attestation:end -->';

export type ProjectContributionAuthorization = {
	schemaVersion: typeof TREESEED_CONTRIBUTION_GRANT_VERSION; id: string; generation: number;
	status: 'active' | 'revoked' | 'superseded' | 'expired'; projectId: string;
	repository: { provider: string; owner: string; name: string };
	grant: { version: string; digest: string }; authorizedBy: { principalId: string; displayName?: string };
	agentIds: string[]; capacityProviderIds: string[]; contributionModes: Array<'agent-assisted' | 'agent-authored'>;
	targetBranches: string[]; allowedActions: Array<'populate_pr_attestation' | 'update_pr_attestation'>;
	effectiveAt: string; expiresAt?: string | null; revokedAt?: string | null;
};

export type AgentContributionAttestation = {
	schemaVersion: typeof TREESEED_AGENT_CONTRIBUTION_ATTESTATION_VERSION;
	authorization: { id: string; generation: number; digest: string }; projectId: string;
	repository: { provider: string; owner: string; name: string }; assignmentId: string; checkpointId?: string | null;
	agentId: string; capacityProviderId: string; mode: 'agent-assisted' | 'agent-authored';
	base: { branch: string; sha: string }; head: { branch: string; sha: string }; issuedAt: string;
	receipt: { keyId: string; algorithm: 'Ed25519'; payloadDigest: string; signature: string };
};

export type AgentContributionPermission = {
	mode: 'disabled' | 'delegated-project-authorization'; mayPopulatePrAttestation: boolean;
	requiredCapability: typeof TREESEED_AGENT_CONTRIBUTION_CAPABILITY; requireExactHead: true;
};
export type ContributionDiagnostic = { code: string; path: string; message: string };

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const sha = (value: unknown) => /^[a-f0-9]{40}$/u.test(text(value));
const timestamp = (value: unknown) => Number.isFinite(Date.parse(text(value)));
const sameRepository = (left: ProjectContributionAuthorization['repository'], right: AgentContributionAttestation['repository']) => left.provider === right.provider && left.owner === right.owner && left.name === right.name;

export function validateProjectContributionAuthorization(value: unknown, now = new Date()) {
	const source = record(value); const diagnostics: ContributionDiagnostic[] = [];
	const add = (code: string, path: string, message: string) => diagnostics.push({ code, path, message });
	if (source.schemaVersion !== TREESEED_CONTRIBUTION_GRANT_VERSION) add('contribution_authorization_schema_invalid', 'schemaVersion', 'Unsupported contribution authorization schema.');
	for (const key of ['id','projectId','effectiveAt'] as const) if (!text(source[key])) add('contribution_authorization_field_required', key, `${key} is required.`);
	if (!Number.isInteger(source.generation) || Number(source.generation) < 1) add('contribution_authorization_generation_invalid', 'generation', 'generation must be a positive integer.');
	if (!['active','revoked','superseded','expired'].includes(text(source.status))) add('contribution_authorization_status_invalid', 'status', 'status is invalid.');
	const repository = record(source.repository); for (const key of ['provider','owner','name']) if (!text(repository[key])) add('contribution_authorization_repository_invalid', `repository.${key}`, `${key} is required.`);
	const grant = record(source.grant); if (!text(grant.version) || !text(grant.digest)) add('contribution_authorization_grant_invalid', 'grant', 'Versioned grant text and digest are required.');
	if (!text(record(source.authorizedBy).principalId)) add('contribution_authorization_human_required', 'authorizedBy.principalId', 'An accountable human principal is required.');
	for (const key of ['agentIds','capacityProviderIds','contributionModes','targetBranches','allowedActions']) if (!Array.isArray(source[key]) || source[key].length === 0) add('contribution_authorization_scope_empty', key, `${key} must be non-empty.`);
	if (!timestamp(source.effectiveAt)) add('contribution_authorization_time_invalid', 'effectiveAt', 'effectiveAt must be an ISO timestamp.');
	if (source.expiresAt != null && (!timestamp(source.expiresAt) || Date.parse(text(source.expiresAt)) <= now.getTime())) add('contribution_authorization_expired', 'expiresAt', 'Authorization is expired or has an invalid expiry.');
	if (source.status !== 'active') add('contribution_authorization_inactive', 'status', 'Authorization is not active.');
	return { ok: diagnostics.length === 0, diagnostics, authorization: diagnostics.length ? null : value as ProjectContributionAuthorization };
}

export function validateAgentContributionAttestation(input: { authorization: ProjectContributionAuthorization; attestation: AgentContributionAttestation; expected: { projectId: string; repository: AgentContributionAttestation['repository']; assignmentId: string; baseBranch: string; baseSha: string; headBranch: string; headSha: string }; now?: Date }) {
	const diagnostics = [...validateProjectContributionAuthorization(input.authorization, input.now).diagnostics];
	const a = input.attestation; const grant = input.authorization; const expected = input.expected;
	const add = (code: string, path: string, message: string) => diagnostics.push({ code, path, message });
	if (a.schemaVersion !== TREESEED_AGENT_CONTRIBUTION_ATTESTATION_VERSION) add('contribution_attestation_schema_invalid', 'schemaVersion', 'Unsupported contribution attestation schema.');
	if (a.authorization.id !== grant.id || a.authorization.generation !== grant.generation || a.authorization.digest !== grant.grant.digest) add('contribution_attestation_authorization_mismatch', 'authorization', 'Authorization binding does not match the active project grant.');
	if (a.projectId !== expected.projectId || a.projectId !== grant.projectId) add('contribution_attestation_project_mismatch', 'projectId', 'Project binding does not match.');
	if (!sameRepository(grant.repository, a.repository) || !sameRepository(grant.repository, expected.repository)) add('contribution_attestation_repository_mismatch', 'repository', 'Repository binding does not match.');
	if (a.assignmentId !== expected.assignmentId) add('contribution_attestation_assignment_mismatch', 'assignmentId', 'Assignment binding does not match.');
	if (!grant.agentIds.includes(a.agentId)) add('contribution_attestation_agent_unauthorized', 'agentId', 'Agent is not authorized by the project grant.');
	if (!grant.capacityProviderIds.includes(a.capacityProviderId)) add('contribution_attestation_provider_unauthorized', 'capacityProviderId', 'Capacity provider is not authorized by the project grant.');
	if (!grant.contributionModes.includes(a.mode)) add('contribution_attestation_mode_unauthorized', 'mode', 'Contribution mode is not authorized.');
	if (!grant.targetBranches.includes(a.base.branch) || a.base.branch !== expected.baseBranch) add('contribution_attestation_target_unauthorized', 'base.branch', 'Target branch is not authorized.');
	if (!sha(a.base.sha) || a.base.sha !== expected.baseSha || !sha(a.head.sha) || a.head.sha !== expected.headSha || a.head.branch !== expected.headBranch) add('contribution_attestation_exact_ref_mismatch', 'head', 'Exact base/head binding is stale or invalid.');
	if (!grant.allowedActions.includes('populate_pr_attestation')) add('contribution_attestation_action_unauthorized', 'authorization.allowedActions', 'Project grant does not allow PR attestation.');
	if (!timestamp(a.issuedAt) || !text(a.receipt.keyId) || a.receipt.algorithm !== 'Ed25519' || !text(a.receipt.payloadDigest) || !text(a.receipt.signature)) add('contribution_attestation_receipt_invalid', 'receipt', 'A complete signed receipt is required.');
	return { ok: diagnostics.length === 0, diagnostics };
}

export function renderAgentContributionAttestationBlock(attestation: AgentContributionAttestation) {
	return `${TREESEED_CONTRIBUTION_BLOCK_START}\nAgent contribution authorization: \`${attestation.authorization.id}@${attestation.authorization.generation}\`\n\`\`\`json treeseed-contribution-attestation\n${JSON.stringify(attestation, null, 2)}\n\`\`\`\n${TREESEED_CONTRIBUTION_BLOCK_END}`;
}

export function parseAgentContributionAttestationBlock(body: string): AgentContributionAttestation | null {
	const start = body.indexOf(TREESEED_CONTRIBUTION_BLOCK_START); const end = body.indexOf(TREESEED_CONTRIBUTION_BLOCK_END);
	if (start < 0 || end <= start) return null;
	const match = /```json treeseed-contribution-attestation\s+([\s\S]*?)\s+```/u.exec(body.slice(start, end));
	if (!match) return null;
	try { return JSON.parse(match[1]!) as AgentContributionAttestation; } catch { return null; }
}
