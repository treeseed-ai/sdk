import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

export type Schema = Record<string, unknown>;
export type CanonicalSchema = Schema & { $defs: Record<string, Schema | boolean>;
	oneOf: { $ref: string }[] };
const path = 'docs/agent.schema.yml';
let authority: { root: string; commit: string; bytes: string; digest: string;
	document: CanonicalSchema } | undefined;

// Consume the existing development workspace authority, never a guessed parent,
// runtime-generated oracle, copied target file, or moving network reference.
export function canonicalAuthority() {
	if (authority) return authority;
	const root = process.env.TREESEED_DEVELOPMENT_WORKSPACE_ROOT;
	if (!root) throw new Error('Canonical tests require TREESEED_DEVELOPMENT_WORKSPACE_ROOT; missing authority blocks coverage.');
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
	const commit = git('rev-parse', 'HEAD');
	if (git('status', '--porcelain', '--', path)) throw new Error('Canonical schema must be clean and tracked at the selected commit.');
	const bytes = readFileSync(resolve(root, path), 'utf8');
	if (execFileSync('git', ['show', `${commit}:${path}`], { cwd: root, encoding: 'utf8' }) !== bytes) {
		throw new Error('Canonical schema bytes differ from exact Git authority.');
	}
	const document = parse(bytes) as CanonicalSchema;
	if (!document.$defs || !Array.isArray(document.oneOf) || !document.oneOf.length) {
		throw new Error('Canonical authority lacks definitions or its stored-record union.');
	}
	authority = { root, commit, bytes, digest: createHash('sha256').update(bytes).digest('hex'), document };
	return authority;
}

export function assertCanonicalAuthorityUnchanged() {
	if (!authority) return;
	const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: authority.root, encoding: 'utf8' }).trim();
	if (commit !== authority.commit || readFileSync(resolve(authority.root, path), 'utf8') !== authority.bytes) {
		throw new Error('Canonical authority moved during the diagnostic invocation.');
	}
}

export function storedDefinitions(document: CanonicalSchema): string[] {
	return document.oneOf.map(entry => {
		if (!/^#\/\$defs\/[^/]+$/.test(entry.$ref)) throw new Error(`Invalid canonical root reference ${entry.$ref}`);
		const name = entry.$ref.slice('#/$defs/'.length);
		if (!Object.hasOwn(document.$defs, name)) throw new Error(`Missing canonical definition ${name}`);
		return name;
	});
}

export function schemaRecord(value: unknown): Schema {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected schema object.');
	return value as Schema;
}

// Paths come from the authored target itself, not a model/field inventory copied
// from runtime code. Only assertion keywords are mutations; prose is not policy.
export function constraintPaths(value: unknown, path: string[] = []): string[][] {
	if (!value || typeof value !== 'object') return [];
	const keywords = new Set(['$ref', 'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'minLength', 'maxLength', 'pattern',
		'format', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems',
		'maxItems', 'minProperties', 'uniqueItems', 'allOf', 'anyOf', 'oneOf', 'not', 'if',
		'then', 'else', 'contains']);
	return Object.entries(value).flatMap(([key, child]) => [
		...(keywords.has(key) ? [[...path, key]] : []),
		...constraintPaths(child, [...path, key]),
	]);
}

export function removeConstraint(document: CanonicalSchema, name: string, path: string[]) {
	let parent: unknown = document.$defs[name];
	for (const key of path.slice(0, -1)) {
		parent = Array.isArray(parent) ? parent[Number(key)] : schemaRecord(parent)[key];
	}
	delete schemaRecord(parent)[path.at(-1)!];
}
