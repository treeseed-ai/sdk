import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { verifyPlatformRepository } from '../../../../src/platform/index.ts';
import { partialSdkDocument, type Declaration } from './schema-verification-fixture.ts';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function repository(document: Declaration) {
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
		'commit', '--quiet', '-m', 'Isolated incomplete declaration'], { cwd: root });
	return root;
}

describe('native Platform architecture-schema custody', () => {
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
