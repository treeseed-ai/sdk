import { StandardsError } from './errors.ts';
import type { StandardsContractFamily } from './contracts.ts';

export interface StandardsManifestContract {
	id: string;
	family: StandardsContractFamily;
	version: string;
	semanticRange: string;
	source: string;
	artifact: string;
	verifier: string;
}

export interface StandardsPackageManifest {
	schemaVersion: 1;
	workflow: { enabled: boolean };
	produced: StandardsManifestContract[];
	consumed: StandardsManifestContract[];
	guarantees: string[];
	deprecations: string[];
	runtimes: string[];
	rollbackOperations: string[];
}

export interface StandardsManifestInspection {
	manifest: StandardsPackageManifest | null;
	errors: string[];
}

const families = new Set<StandardsContractFamily>(['typescript', 'openapi', 'json-schema', 'behavioral']);
const safePath = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[\w@./-]+$/u;
const semanticVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const semanticRange = /^(?:[~^]|>=?|<=?)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.*-]+)?(?:\s+(?:[~^]|>=?|<=?)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.*-]+)?)?$|^\*$/u;

function record(value: unknown, path: string) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StandardsError('standards_invalid_contract', 'Expected an object.', path);
	return value as Record<string, unknown>;
}

function string(value: unknown, path: string) {
	if (typeof value !== 'string' || !value.trim()) throw new StandardsError('standards_invalid_contract', 'Expected a non-empty string.', path);
	return value.trim();
}

function strings(value: unknown, path: string) {
	if (!Array.isArray(value)) throw new StandardsError('standards_invalid_contract', 'Expected a string array.', path);
	const entries = value.map((entry, index) => string(entry, `${path}[${index}]`));
	if (new Set(entries).size !== entries.length) throw new StandardsError('standards_duplicate_identity', 'Duplicate array value.', path);
	return entries.sort();
}

function contract(value: unknown, path: string): StandardsManifestContract {
	const input = record(value, path);
	const family = string(input.family, `${path}.family`) as StandardsContractFamily;
	if (!families.has(family)) throw new StandardsError('standards_invalid_contract', `Unsupported contract family: ${family}.`, `${path}.family`);
	const version = string(input.version, `${path}.version`);
	if (!semanticVersion.test(version)) throw new StandardsError('standards_invalid_semantic_version', 'Contract version must be semantic.', `${path}.version`);
	const range = string(input.semanticRange, `${path}.semanticRange`);
	if (!semanticRange.test(range)) throw new StandardsError('standards_invalid_semantic_version', 'Contract semanticRange is invalid.', `${path}.semanticRange`);
	const paths = ['source', 'artifact', 'verifier'] as const;
	const normalizedPaths = Object.fromEntries(paths.map((key) => {
		const entry = string(input[key], `${path}.${key}`);
		if (!safePath.test(entry)) throw new StandardsError('standards_invalid_contract', `${key} must be a safe repository-relative path.`, `${path}.${key}`);
		return [key, entry];
	})) as Record<typeof paths[number], string>;
	return { id: string(input.id, `${path}.id`), family, version, semanticRange: range, ...normalizedPaths };
}

function contracts(value: unknown, path: string) {
	if (!Array.isArray(value)) throw new StandardsError('standards_invalid_contract', 'Expected a contract array.', path);
	const entries = value.map((entry, index) => contract(entry, `${path}[${index}]`));
	const ids = entries.map((entry) => entry.id);
	if (new Set(ids).size !== ids.length) throw new StandardsError('standards_duplicate_identity', 'Duplicate contract id.', path);
	return entries.sort((left, right) => left.id.localeCompare(right.id));
}

export function parseStandardsPackageManifest(value: unknown): StandardsPackageManifest {
	const input = record(value, 'standards');
	if (input.schemaVersion !== 1) throw new StandardsError('standards_invalid_contract', 'standards.schemaVersion must be 1.', 'standards.schemaVersion');
	const workflow = record(input.workflow, 'standards.workflow');
	if (typeof workflow.enabled !== 'boolean') throw new StandardsError('standards_invalid_contract', 'workflow.enabled must be boolean.', 'standards.workflow.enabled');
	return {
		schemaVersion: 1,
		workflow: { enabled: workflow.enabled },
		produced: contracts(input.produced ?? [], 'standards.produced'),
		consumed: contracts(input.consumed ?? [], 'standards.consumed'),
		guarantees: strings(input.guarantees ?? [], 'standards.guarantees'),
		deprecations: strings(input.deprecations ?? [], 'standards.deprecations'),
		runtimes: strings(input.runtimes ?? [], 'standards.runtimes'),
		rollbackOperations: strings(input.rollbackOperations ?? [], 'standards.rollbackOperations'),
	};
}

export function inspectStandardsPackageManifest(value: unknown): StandardsManifestInspection {
	try {
		return { manifest: parseStandardsPackageManifest(value), errors: [] };
	} catch (error) {
		return { manifest: null, errors: [error instanceof Error ? error.message : String(error)] };
	}
}
