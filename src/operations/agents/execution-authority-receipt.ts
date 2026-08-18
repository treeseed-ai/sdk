import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { repositoryIdentityKey } from '../../repositories/repository-identity.ts';
import type { DecisionDependencyReference } from '../../governance/policy/decision-dependencies.ts';
import type { AgentWorkExecutionMode,UpstreamMutationPolicy } from '../../agent-capacity/contracts/support/authority/execution-mode.ts';

export type GovernedExecutionAuthority = {
	schemaVersion: 2;
	kind: 'treeseed.governed-execution-authority/v2';
	authorityId: string;
	createdAt: string;
	teamId: string | null;
	projectId: string;
	proposalId: string | null;
	proposalVersion: number | null;
	proposalContentHash: string | null;
	decisionId: string;
	decisionDependencies: DecisionDependencyReference[];
	assignmentId: string;
	executionMode: AgentWorkExecutionMode;
	upstreamMutationPolicy: UpstreamMutationPolicy;
	graphId: string;
	graphNodeId: string;
	deliverableManifestId: string;
	deliverableContractId: string;
	repository: { canonicalKey: string; remoteUrl: string };
	sourceBranch: string;
	baseCommit: string;
	checkpointCommit: string;
	integratedCommit: string;
	changedPaths: string[];
};

type AuthorityFields = Omit<GovernedExecutionAuthority, 'schemaVersion' | 'kind' | 'authorityId' | 'createdAt' | 'executionMode' | 'upstreamMutationPolicy'> & {
	executionMode?: AgentWorkExecutionMode;
	upstreamMutationPolicy?: UpstreamMutationPolicy;
};

function canonicalFields(fields: AuthorityFields) {
	return {
		...fields,
		executionMode: fields.executionMode ?? 'production',
		upstreamMutationPolicy: fields.upstreamMutationPolicy ?? (fields.executionMode === 'simulation' ? 'denied' : 'exact-approved-ref'),
		decisionDependencies: [...fields.decisionDependencies].sort((left, right) =>
			`${left.projectId}:${left.decisionId}`.localeCompare(`${right.projectId}:${right.decisionId}`)),
		changedPaths: [...new Set(fields.changedPaths)].sort(),
	};
}

function authorityId(fields: AuthorityFields) {
	return createHash('sha256').update(JSON.stringify(canonicalFields(fields))).digest('hex');
}

export function governedExecutionAuthorityValid(receipt: GovernedExecutionAuthority) {
	if (receipt.kind !== 'treeseed.governed-execution-authority/v2' || receipt.schemaVersion !== 2) return false;
	if (receipt.executionMode === 'simulation' && receipt.upstreamMutationPolicy !== 'denied') return false;
	if (receipt.executionMode === 'production' && receipt.upstreamMutationPolicy !== 'exact-approved-ref') return false;
	const { schemaVersion: _schemaVersion, kind: _kind, authorityId: observedId, createdAt: _createdAt, ...fields } = receipt;
	return observedId === authorityId(fields);
}

function repositoryReceiptPrefix(canonicalKey: string) {
	return createHash('sha256').update(canonicalKey).digest('hex').slice(0, 16);
}

export function writeGovernedExecutionAuthority(storageRoot: string, fields: AuthorityFields) {
	const canonical = canonicalFields(fields);
	const receipt: GovernedExecutionAuthority = {
		schemaVersion: 2,
		kind: 'treeseed.governed-execution-authority/v2',
		authorityId: authorityId(canonical),
		createdAt: new Date().toISOString(),
		...canonical,
	};
	const path = resolve(storageRoot, '.treeseed', 'governance', 'execution-authorities', `${repositoryReceiptPrefix(receipt.repository.canonicalKey)}--${receipt.assignmentId}.json`);
	if (existsSync(path)) {
		try {
			const existing = JSON.parse(readFileSync(path, 'utf8')) as GovernedExecutionAuthority;
			if (existing.authorityId === receipt.authorityId) return { path, receipt: existing };
		} catch { /* Replace malformed local evidence only after the governed operation re-verifies it. */ }
	}
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
	return { path, receipt };
}

export function readGovernedExecutionAuthorities(storageRoot: string) {
	const directory = resolve(storageRoot, '.treeseed', 'governance', 'execution-authorities');
	if (!existsSync(directory)) return [];
	return readdirSync(directory).filter((name) => name.endsWith('.json')).sort().flatMap((name) => {
		try {
			const receipt = JSON.parse(readFileSync(resolve(directory, name), 'utf8')) as GovernedExecutionAuthority;
			return governedExecutionAuthorityValid(receipt) ? [receipt] : [];
		} catch {
			return [];
		}
	});
}

export function authorityMatchesRepository(receipt: GovernedExecutionAuthority, remoteUrl: string) {
	return receipt.repository.canonicalKey === repositoryIdentityKey(remoteUrl);
}
