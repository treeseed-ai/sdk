import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { verifyPlatformRepository } from '../../../../src/platform/index.ts';
import { definition, partialSdkDocument } from './schema-verification-fixture.ts';
import { assertCanonicalAuthorityUnchanged, canonicalAuthority, constraintPaths, removeConstraint, storedDefinitions, schemaRecord } from './canonical-schema-fixture.ts';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
afterAll(assertCanonicalAuthorityUnchanged);

function repository(document: unknown) {
	const root = mkdtempSync(resolve(tmpdir(), 'architecture-schema-custody-'));
	roots.push(root);
	mkdirSync(resolve(root, 'docs'));
	mkdirSync(resolve(root, 'seeds'));
	writeFileSync(resolve(root, 'treeseed.site.yaml'), 'development:\n  local:\n    inventory: { source: seed, path: seeds/inventory.yaml }\n');
	writeFileSync(resolve(root, 'seeds/inventory.yaml'), 'schemaVersion: treeseed.seed-bundle/v3\nresources: { projects: [], repositories: [] }\n');
	writeFileSync(resolve(root, 'docs/agent.schema.yml'), stringify(document));
	execFileSync('git', ['init', '--quiet'], { cwd: root });
	execFileSync('git', ['add', '.'], { cwd: root });
	execFileSync('git', ['-c', 'user.name=Architecture test', '-c', 'user.email=architecture@example.test',
		'commit', '--quiet', '-m', 'Isolated schema declaration'], { cwd: root });
	return root;
}

describe('native Platform architecture-schema custody', () => {
	it('native public repository verification preserves finite enum equivalence without accepting changed overlapping or qualified committed scalar authority', () => {
		const { document } = canonicalAuthority(), root = repository(document), path = resolve(root, 'docs/agent.schema.yml');
		const bytes = readFileSync(path, 'utf8'), commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
		const baseline = verifyPlatformRepository(root), choices = ['general', 'feedback', 'research', 'workday-report'];
		for (const keyword of ['anyOf', 'oneOf'] as const) {
			const changed = structuredClone(document);
			schemaRecord(schemaRecord(changed.$defs.Note).properties).classification = { [keyword]: choices.map(value => ({ const: value })).reverse() };
			schemaRecord(schemaRecord(changed.$defs.ExecutionNode).properties).pairRole = { [keyword]: [{ enum: ['reviewer', 'actor'] }, { type: 'null' }] };
			const supplied = stringify(changed); writeFileSync(path, supplied);
			const result = verifyPlatformRepository(root); expect(result.ok).toBe(false);
			expect(result.diagnostics).toEqual(baseline.diagnostics);
			expect(readFileSync(path, 'utf8')).toBe(supplied);
			expect(execFileSync('git', ['show', `${commit}:docs/agent.schema.yml`], { cwd: root, encoding: 'utf8' })).toBe(bytes);
		}
		for (const field of [
			{ anyOf: choices.slice(1).map(value => ({ const: value })) },
			{ anyOf: [...choices.map(value => ({ const: value })), { type: 'null' }] },
			{ oneOf: [...choices.map(value => ({ const: value })), { const: 'general' }] },
			{ oneOf: [{ enum: choices }, { type: 'string' }] },
			{ anyOf: [{ enum: choices, maxLength: 6 }] },
		]) {
			const changed = structuredClone(document); schemaRecord(schemaRecord(changed.$defs.Note).properties).classification = field;
			const supplied = stringify(changed); writeFileSync(path, supplied);
			const denied = verifyPlatformRepository(root); expect(denied.ok).toBe(false);
			expect(denied.diagnostics).toContainEqual(expect.objectContaining({ code: 'agent_schema_structure_mismatch',
				message: expect.stringContaining('Note nested declarative constraints differ') }));
			expect(readFileSync(path, 'utf8')).toBe(supplied);
			expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()).toBe(commit);
			expect(execFileSync('git', ['show', `${commit}:docs/agent.schema.yml`], { cwd: root, encoding: 'utf8' })).toBe(bytes);
		}
		writeFileSync(path, bytes); expect(verifyPlatformRepository(root)).toEqual(baseline);
	});
	it('native public repository verification binds ended workday report authority and preserves original conditional bytes through denial and retry', () => {
		const { document } = canonicalAuthority(), root = repository(document), path = resolve(root, 'docs/agent.schema.yml');
		const bytes = readFileSync(path, 'utf8'), commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
		const baseline = verifyPlatformRepository(root);
		expect(baseline.diagnostics.filter(entry => entry.message.startsWith('Workday '))).toEqual([]);
		for (const mode of ['missing-condition', 'changed-state', 'changed-required-field', 'contradictory-kind'] as const) {
			const changed = structuredClone(document), definition = schemaRecord(changed.$defs.Workday);
			if (!Array.isArray(definition.allOf)) throw new Error('Canonical Workday conditional required.');
			const first = schemaRecord(definition.allOf[0]);
			if (mode === 'missing-condition') delete definition.allOf;
			else if (mode === 'changed-state') schemaRecord(schemaRecord(schemaRecord(first.if).properties).state).const = 'closing';
			else if (mode === 'changed-required-field') schemaRecord(first.then).required = ['endedAt'];
			else schemaRecord(first.then).type = 'string';
			const supplied = stringify(changed); writeFileSync(path, supplied);
			const denied = verifyPlatformRepository(root); expect(denied.ok).toBe(false);
			expect(denied.diagnostics).toContainEqual(expect.objectContaining({ code: 'agent_schema_structure_mismatch',
				message: expect.stringContaining('Workday nested declarative constraints differ') }));
			expect(readFileSync(path, 'utf8')).toBe(supplied);
			expect(execFileSync('git', ['show', `${commit}:docs/agent.schema.yml`], { cwd: root, encoding: 'utf8' })).toBe(bytes);
			expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()).toBe(commit);
		}
		writeFileSync(path, bytes); expect(verifyPlatformRepository(root)).toEqual(baseline);
		// Other full canonical defects remain denied; this is no managed closure.
	});
	it('native public repository verification retains canonical assignment identifiers and graph revision uniqueness through denied substitutions and exact retry', () => {
		const { document } = canonicalAuthority(), root = repository(document), path = resolve(root, 'docs/agent.schema.yml');
		const bytes = readFileSync(path, 'utf8'), commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
		const baseline = verifyPlatformRepository(root), names = ['AssignmentAttempt', 'AssignmentContext', 'GraphRevision'];
		expect(names.map(name => ({ name, diagnostics: baseline.diagnostics.filter(entry => entry.message.startsWith(`${name} `)) })))
			.toEqual(names.map(name => ({ name, diagnostics: [] })));
		for (const [name, field] of [['AssignmentAttempt', 'requiredCapabilities'], ['AssignmentAttempt', 'predecessorResultIds'], ['GraphRevision', 'changedSourceRefs']]) {
			if (!name || !field) throw new Error('Native inventory identity required.');
			const changed = structuredClone(document);
			delete schemaRecord(schemaRecord(schemaRecord(changed.$defs[name]).properties)[field]).uniqueItems;
			const supplied = stringify(changed); writeFileSync(path, supplied);
			const denied = verifyPlatformRepository(root); expect(denied.ok).toBe(false);
			expect(denied.diagnostics).toContainEqual(expect.objectContaining({ code: 'agent_schema_structure_mismatch',
				message: expect.stringContaining(`${name} nested declarative constraints differ`) }));
			expect(readFileSync(path, 'utf8')).toBe(supplied);
			expect(execFileSync('git', ['show', `${commit}:docs/agent.schema.yml`], { cwd: root, encoding: 'utf8' })).toBe(bytes);
			expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()).toBe(commit);
		}
		writeFileSync(path, bytes); expect(verifyPlatformRepository(root)).toEqual(baseline);
		// Other whole-canonical diagnostics remain fatal, not a managed PASS.
	});
	it('native public verification recognizes disjoint union semantics and retains overlapping or untagged denied bytes before exact committed retry', () => {
		const { document } = canonicalAuthority(), root = repository(document), path = resolve(root, 'docs/agent.schema.yml');
		const bytes = readFileSync(path, 'utf8'), commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
		const baseline = verifyPlatformRepository(root), names = ['AssignmentWorkspace', 'AssignmentReference'];
		expect(names.map(name => baseline.diagnostics.filter(entry => entry.message.startsWith(`${name} `)))).toEqual([[], []]);
		for (const mutation of ['duplicate-branch', 'missing-tag', 'shared-tag', 'missing-required-tag', 'removed-bound'] as const) {
			const changed = structuredClone(document), union = schemaRecord(changed.$defs.AssignmentWorkspace);
			if (mutation === 'duplicate-branch') { if (!Array.isArray(union.oneOf)) throw new Error('Union required'); union.oneOf.push(union.oneOf[0]); }
			else if (mutation === 'removed-bound') delete schemaRecord(schemaRecord(schemaRecord(changed.$defs.GitAssignmentWorkspace).properties).branch).minLength;
			else { const branch = schemaRecord(changed.$defs.ReadOnlyWorkspace), properties = schemaRecord(branch.properties);
				if (mutation === 'missing-tag') delete schemaRecord(properties.mode).const;
				else if (mutation === 'shared-tag') schemaRecord(properties.mode).const = 'git';
				else branch.required = []; }
			const supplied = stringify(changed); writeFileSync(path, supplied);
			const denied = verifyPlatformRepository(root); expect(denied.ok).toBe(false);
			expect(denied.diagnostics).toContainEqual(expect.objectContaining({ code: 'agent_schema_structure_mismatch', message: expect.stringContaining('AssignmentWorkspace nested declarative constraints differ') }));
			expect(readFileSync(path, 'utf8')).toBe(supplied);
			expect(execFileSync('git', ['show', `${commit}:docs/agent.schema.yml`], { cwd: root, encoding: 'utf8' })).toBe(bytes);
			expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()).toBe(commit);
		}
		writeFileSync(path, bytes); expect(verifyPlatformRepository(root)).toEqual(baseline);
		// Other whole-target diagnostics remain fatal; this is not managed acceptance.
	});
	it('native public verification retains exact committed accounting identifier and writable-path authority through bounds denial and unchanged retry', () => {
		const { document } = canonicalAuthority(), root = repository(document), path = resolve(root, 'docs/agent.schema.yml');
		const bytes = readFileSync(path, 'utf8'), commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
		const baseline = verifyPlatformRepository(root), names = ['Lease', 'Reservation', 'UsageSettlement', 'TreeDxAssignmentWorkspace', 'GitAssignmentWorkspace'];
		expect(names.map(name => ({ name, diagnostics: baseline.diagnostics.filter(entry => entry.message.startsWith(`${name} `)) })))
			.toEqual(names.map(name => ({ name, diagnostics: [] })));
		for (const name of ['TreeDxAssignmentWorkspace', 'GitAssignmentWorkspace']) {
			const changed = structuredClone(document);
			delete schemaRecord(schemaRecord(schemaRecord(changed.$defs[name]).properties).writablePaths).minItems;
			const supplied = stringify(changed); writeFileSync(path, supplied);
			const denied = verifyPlatformRepository(root); expect(denied.ok).toBe(false);
			expect(denied.diagnostics).toContainEqual(expect.objectContaining({ code: 'agent_schema_structure_mismatch',
				message: expect.stringContaining(`${name} nested declarative constraints differ`) }));
			expect(readFileSync(path, 'utf8')).toBe(supplied);
			expect(execFileSync('git', ['show', `${commit}:docs/agent.schema.yml`], { cwd: root, encoding: 'utf8' })).toBe(bytes);
			expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()).toBe(commit);
		}
		writeFileSync(path, bytes); expect(verifyPlatformRepository(root)).toEqual(baseline);
		// Other unresolved whole canonical definitions still block acceptance.
	});
	it('native public repository verification binds every exact reference condition to the owning validator and retains committed authority through denial and retry', () => {
		const { document } = canonicalAuthority(), root = repository(document), path = resolve(root, 'docs/agent.schema.yml');
		const bytes = readFileSync(path, 'utf8'), commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
		const baseline = verifyPlatformRepository(root);
		expect(baseline.ok).toBe(false);
		expect(baseline.diagnostics.filter(entry => entry.message.startsWith('ExactEntityReference '))).toEqual([]);
		const constraints = schemaRecord(document.$defs.ExactEntityReference).allOf;
		if (!Array.isArray(constraints)) throw new Error('Exact reference conditions required.');
		for (let index = 0; index < constraints.length; index++) {
			const changed = structuredClone(document);
			schemaRecord(changed.$defs.ExactEntityReference).allOf = constraints.filter((_, position) => position !== index);
			const supplied = stringify(changed); writeFileSync(path, supplied);
			const denied = verifyPlatformRepository(root); expect(denied.ok).toBe(false);
			expect(denied.diagnostics).toContainEqual(expect.objectContaining({ code: 'agent_schema_structure_mismatch',
				message: expect.stringContaining('ExactEntityReference nested declarative constraints differ') }));
			expect(readFileSync(path, 'utf8')).toBe(supplied);
			expect(execFileSync('git', ['show', `${commit}:docs/agent.schema.yml`], { cwd: root, encoding: 'utf8' })).toBe(bytes);
			expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()).toBe(commit);
		}
		writeFileSync(path, bytes); expect(verifyPlatformRepository(root)).toEqual(baseline);
		// Unimplemented canonical models remain denied, not relabelled complete.
	});
	it('native public repository verification resolves exact nested schema references while retaining committed bytes through missing moved and cyclic denial', () => {
		const document = partialSdkDocument();
		document.$defs['reference~/namespace'] = { properties: { title: structuredClone(definition(document, 'Book').properties.title!) }, required: [] };
		definition(document, 'Book').properties.title = { $ref: '#/$defs/reference~0~1namespace/properties/title' };
		const root = repository(document), path = resolve(root, 'docs/agent.schema.yml'), bytes = readFileSync(path, 'utf8');
		const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
		const baseline = verifyPlatformRepository(root); expect(baseline.ok).toBe(false);
		expect(baseline.diagnostics.filter(entry => entry.message.startsWith('Book '))).toEqual([]);
		for (const mutation of ['missing', 'moved', 'cyclic'] as const) {
			const supplied = structuredClone(document);
			if (mutation === 'missing') delete definition(supplied, 'reference~/namespace').properties.title;
			else if (mutation === 'moved') definition(supplied, 'reference~/namespace').properties.title!.maxLength = 1;
			else definition(supplied, 'reference~/namespace').properties.title = { $ref: '#/$defs/Book/properties/title' };
			const input = stringify(supplied); writeFileSync(path, input);
			const denied = verifyPlatformRepository(root); expect(denied.ok).toBe(false);
			expect(denied.diagnostics).toContainEqual(expect.objectContaining({ code: 'agent_schema_structure_mismatch',
				message: expect.stringContaining('Book nested declarative constraints differ') }));
			expect(readFileSync(path, 'utf8')).toBe(input);
			expect(execFileSync('git', ['show', `${commit}:docs/agent.schema.yml`], { cwd: root, encoding: 'utf8' })).toBe(bytes);
			expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()).toBe(commit);
		}
		writeFileSync(path, bytes); expect(verifyPlatformRepository(root)).toEqual(baseline);
		// The supplied five-model declaration remains incomplete and denied;
		// this is exact reference resolution, not whole canonical acceptance.
	});
	it('native public repository verification binds graph and planning uniqueness and retains exact committed inputs through denial and retry', () => {
		const { document, bytes } = canonicalAuthority(), root = repository(document), path = resolve(root, 'docs/agent.schema.yml');
		const original = readFileSync(path, 'utf8'), commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
		const baseline = verifyPlatformRepository(root);
		for (const name of ['GraphChangeSet', 'PlanningRound']) {
			expect(baseline.diagnostics.filter(entry => entry.message.startsWith(`${name} `)), name).toEqual([]);
			const properties = schemaRecord(schemaRecord(document.$defs[name]).properties);
			for (const [field, value] of Object.entries(properties)) if (schemaRecord(value).uniqueItems === true) {
				const changed = structuredClone(document);
				delete schemaRecord(schemaRecord(schemaRecord(changed.$defs[name]).properties)[field]).uniqueItems;
				const supplied = stringify(changed); writeFileSync(path, supplied);
				const denied = verifyPlatformRepository(root);
				expect(denied.ok).toBe(false);
				expect(denied.diagnostics).toContainEqual(expect.objectContaining({ code: 'agent_schema_structure_mismatch',
					message: expect.stringContaining(`${name} nested declarative constraints differ`) }));
				expect(readFileSync(path, 'utf8')).toBe(supplied);
				expect(execFileSync('git', ['show', `${commit}:docs/agent.schema.yml`], { cwd: root, encoding: 'utf8' })).toBe(original);
				expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()).toBe(commit);
			}
		}
		writeFileSync(path, original); expect(verifyPlatformRepository(root)).toEqual(baseline);
		expect(canonicalAuthority().bytes).toBe(bytes);
		// Other unresolved canonical records remain fatal; this proves only the
		// actual owning uniqueness export and native declaration custody.
	});
	it('native public verification denies an omitted executable stored root while retaining the committed declaration and complete definitions', () => {
		const { document } = canonicalAuthority();
		for (const name of ['AgentProfile', 'AssignmentAttempt', 'Lease', 'Reservation']) {
			const changed = structuredClone(document);
			changed.oneOf = changed.oneOf.filter(entry => entry.$ref !== `#/$defs/${name}`);
			const root = repository(changed), path = resolve(root, 'docs/agent.schema.yml');
			const before = readFileSync(path, 'utf8'), commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
			const result = verifyPlatformRepository(root);
			expect(result.ok).toBe(false);
			expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'agent_schema_root_missing',
				message: `${name} executable stored-record authority is absent from the root union.` }));
			expect(readFileSync(path, 'utf8')).toBe(before);
			expect(execFileSync('git', ['show', `${commit}:docs/agent.schema.yml`], { cwd: root, encoding: 'utf8' })).toBe(before);
			expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()).toBe(commit);
		}
	});
	it('the declared CI Platform commit independently resolves the exact held canonical execution bytes without a moving ref or generated replacement', () => {
		const source = readFileSync('.github/workflows/verify.yml', 'utf8');
		const workflow = parse(source) as { jobs: { verify: { steps: Array<{ with?: { repository?: string; ref?: string } }> } } };
		const checkouts = workflow.jobs.verify.steps.filter(step => step.with?.repository === 'treeseed-ai/platform');
		expect(checkouts).toHaveLength(1); const ref = checkouts[0]!.with?.ref;
		expect(ref).toMatch(/^[a-f0-9]{40}$/u); if (!ref) throw new Error('Exact native Platform commit required');
		const held = canonicalAuthority(); expect(ref).toBe(held.commit);
		const actual = execFileSync('git', ['show', `${ref}:docs/agent.schema.yml`], { cwd: held.root, encoding: 'utf8' });
		expect(actual).toBe(held.bytes);
		expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: held.root, encoding: 'utf8' }).trim()).toBe(ref);
		expect(readFileSync(resolve(held.root, 'docs/agent.schema.yml'), 'utf8')).toBe(actual);
		expect(readFileSync('.github/workflows/verify.yml', 'utf8')).toBe(source);
	});
	for (const group of ['stored', 'runtime/shared'] as const) {
		it(`detects each ${group} canonical definition replacement through real committed public repository read-back`, () => {
			const { document } = canonicalAuthority();
			const root = repository(document);
			const stored = new Set(storedDefinitions(document));
			const names = Object.keys(document.$defs).filter(name => stored.has(name) === (group === 'stored'));
			const missed: string[] = [];
			let previous = verifyPlatformRepository(root);
			let commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
			for (const name of names) {
				const changed = structuredClone(document);
				changed.$defs[name] = true;
				const bytes = stringify(changed);
				writeFileSync(resolve(root, 'docs/agent.schema.yml'), bytes);
				execFileSync('git', ['add', 'docs/agent.schema.yml'], { cwd: root });
				execFileSync('git', ['-c', 'user.name=Architecture test', '-c', 'user.email=architecture@example.test',
					'commit', '--quiet', '-m', `Unconstrained canonical ${name}`], { cwd: root });
				const selected = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
				const result = verifyPlatformRepository(root);
				expect(selected).not.toBe(commit);
				expect(result.digest).not.toBe(previous.digest);
				expect(readFileSync(resolve(root, 'docs/agent.schema.yml'), 'utf8')).toBe(bytes);
				if (result.ok || !result.diagnostics.length) missed.push(name);
				previous = result;
				commit = selected;
			}
			expect(missed).toEqual([]);
		});
	}
	it('accepts exact complete canonical schema bytes through native public repository verification', () => {
		const { document, bytes } = canonicalAuthority();
		const root = repository(document);
		writeFileSync(resolve(root, 'docs/agent.schema.yml'), bytes);
		execFileSync('git', ['add', 'docs/agent.schema.yml'], { cwd: root });
		execFileSync('git', ['-c', 'user.name=Architecture test', '-c', 'user.email=architecture@example.test',
			'commit', '--quiet', '-m', 'Exact canonical input bytes'], { cwd: root });
		const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
		const result = verifyPlatformRepository(root);
		expect(readFileSync(resolve(root, 'docs/agent.schema.yml'), 'utf8')).toBe(bytes);
		expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()).toBe(commit);
		expect(result).toMatchObject({ ok: true, diagnostics: [] });
	});
	it('detects committed assignment authority drift independently of existing canonical baseline diagnostics', () => {
		const document = structuredClone(canonicalAuthority().document);
		const root = repository(document);
		const baseline = verifyPlatformRepository(root);
		document.$defs.AssignmentAttempt = true;
		writeFileSync(resolve(root, 'docs/agent.schema.yml'), stringify(document));
		execFileSync('git', ['add', 'docs/agent.schema.yml'], { cwd: root });
		execFileSync('git', ['-c', 'user.name=Architecture test', '-c', 'user.email=architecture@example.test',
			'commit', '--quiet', '-m', 'Unconstrained immutable assignment authority'], { cwd: root });
		const changed = verifyPlatformRepository(root);
		// The original committed failure stays readable. Each controlled field
		// substitution below exercises the SAME public workspace reader without
		// adding a schema validator, runner or a commit per individual assertion.
		const retainedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
		const retainedBytes = readFileSync(resolve(root, 'docs/agent.schema.yml'), 'utf8');
		const original = canonicalAuthority().document, originalBytes = stringify(original), missed: string[] = [];
		writeFileSync(resolve(root, 'docs/agent.schema.yml'), originalBytes);
		const complete = verifyPlatformRepository(root);
		for (const name of ['AssignmentAttempt', 'AssignmentContext', 'AssignmentResult', 'Lease', 'Reservation', 'UsageSettlement']) {
			for (const path of constraintPaths(original.$defs[name])) {
				const altered = structuredClone(original); removeConstraint(altered, name, path);
				const bytes = stringify(altered); writeFileSync(resolve(root, 'docs/agent.schema.yml'), bytes);
				const denied = verifyPlatformRepository(root);
				expect(readFileSync(resolve(root, 'docs/agent.schema.yml'), 'utf8')).toBe(bytes);
				expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()).toBe(retainedCommit);
				if (denied.ok || !denied.diagnostics.length || JSON.stringify(denied.diagnostics) === JSON.stringify(complete.diagnostics)) missed.push(`${name}.${path.join('.')}`);
			}
		}
		// Restore ONLY the controlled workspace input, not the committed failed
		// observation. Exact canonical retry is fresh and cannot erase that blob.
		writeFileSync(resolve(root, 'docs/agent.schema.yml'), originalBytes);
		expect(verifyPlatformRepository(root)).toEqual(complete);
		writeFileSync(resolve(root, 'docs/agent.schema.yml'), retainedBytes);
		expect(execFileSync('git', ['show', `${retainedCommit}:docs/agent.schema.yml`], { cwd: root, encoding: 'utf8' })).toBe(retainedBytes);
		expect(verifyPlatformRepository(root)).toEqual(changed);
		expect(missed).toEqual([]);
		expect(changed.digest).not.toBe(baseline.digest);
		expect(changed.ok).toBe(false);
		expect(changed.diagnostics).not.toEqual(baseline.diagnostics);
	});
	it('rejects an incomplete SDK-generated architecture declaration through native Git repository verification', () => {
		const root = repository(partialSdkDocument());
		const before = readFileSync(resolve(root, 'docs/agent.schema.yml'), 'utf8');
		const result = verifyPlatformRepository(root);
		expect(readFileSync(resolve(root, 'docs/agent.schema.yml'), 'utf8')).toBe(before);
		expect(result).toMatchObject({ schemaVersion: 'treeseed.platform-verification/v1', root, ok: false });
		expect(result.diagnostics.some(entry => entry.path === 'docs/agent.schema.yml')).toBe(true);
	});
	it('read-backs a committed runtime-contract change without accepting unchecked definitions', () => {
		const document = partialSdkDocument();
		const root = repository(document);
		const original = verifyPlatformRepository(root);
		const firstCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
		document.$defs.AssignmentAttempt = true;
		document.oneOf = [{ $ref: '#/$defs/AssignmentAttempt' }];
		writeFileSync(resolve(root, 'docs/agent.schema.yml'), stringify(document));
		execFileSync('git', ['add', 'docs/agent.schema.yml'], { cwd: root });
		execFileSync('git', ['-c', 'user.name=Architecture test', '-c', 'user.email=architecture@example.test',
			'commit', '--quiet', '-m', 'Changed unchecked authority'], { cwd: root });
		const changed = verifyPlatformRepository(root);
		expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()).not.toBe(firstCommit);
		expect(changed.digest).not.toBe(original.digest);
		expect(changed.ok).toBe(false);
		expect(changed.diagnostics.some(entry => entry.message.includes('AssignmentAttempt'))).toBe(true);
	});
	it('retains missing tracked schema denial instead of treating absent authority as a passing replay', () => {
		const root = repository(partialSdkDocument());
		rmSync(resolve(root, 'docs/agent.schema.yml'));
		expect(() => verifyPlatformRepository(root)).not.toThrow();
		expect(verifyPlatformRepository(root)).toMatchObject({ ok: false });
		expect(verifyPlatformRepository(root).diagnostics).toContainEqual(expect.objectContaining({
			code: 'tracked_file_missing', path: 'docs/agent.schema.yml' }));
	});
});
