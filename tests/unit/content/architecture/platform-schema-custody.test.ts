import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { verifyPlatformRepository } from '../../../../src/platform/index.ts';
import { partialSdkDocument } from './schema-verification-fixture.ts';
import { assertCanonicalAuthorityUnchanged, canonicalAuthority, constraintPaths, removeConstraint, storedDefinitions } from './canonical-schema-fixture.ts';

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
