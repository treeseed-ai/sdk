import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { repositoryIdentityKey } from '../../repositories/repository-identity.ts';

export type DecisionDependency = {
	projectId: string;
	decisionId: string;
};

export type GovernedExecutionAuthority = {
	schemaVersion: 1;
	kind: 'treeseed.governed-execution-authority/v1';
	authorityId: string;
	createdAt: string;
	teamId: string | null;
	projectId: string;
	proposalId: string | null;
	proposalVersion: number | null;
	proposalContentHash: string | null;
	decisionId: string;
	decisionDependencies: DecisionDependency[];
	assignmentId: string;
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

type AuthorityFields = Omit<GovernedExecutionAuthority, 'schemaVersion' | 'kind' | 'authorityId' | 'createdAt'>;

function canonicalFields(fields: AuthorityFields) {
	return {
		...fields,
		decisionDependencies: [...fields.decisionDependencies].sort((left, right) =>
			`${left.projectId}:${left.decisionId}`.localeCompare(`${right.projectId}:${right.decisionId}`)),
		changedPaths: [...new Set(fields.changedPaths)].sort(),
	};
}

function authorityId(fields: AuthorityFields) {
	return createHash('sha256').update(JSON.stringify(canonicalFields(fields))).digest('hex');
}

export function governedExecutionAuthorityValid(receipt: GovernedExecutionAuthority) {
	if (receipt.kind !== 'treeseed.governed-execution-authority/v1' || receipt.schemaVersion !== 1) return false;
	const { schemaVersion: _schemaVersion, kind: _kind, authorityId: observedId, createdAt: _createdAt, ...fields } = receipt;
	return observedId === authorityId(fields);
}

function repositoryReceiptPrefix(canonicalKey: string) {
	return createHash('sha256').update(canonicalKey).digest('hex').slice(0, 16);
}

export function writeGovernedExecutionAuthority(storageRoot: string, fields: AuthorityFields) {
	const canonical = canonicalFields(fields);
	const receipt: GovernedExecutionAuthority = {
		schemaVersion: 1,
		kind: 'treeseed.governed-execution-authority/v1',
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
