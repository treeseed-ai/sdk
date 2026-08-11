import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reconcileLocalOrganizationRemotes } from '../../../src/seeds/repositories/organization-reference-migration.ts';

function git(root: string, args: string[]) {
	return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

describe('organization reference migration', () => {
	it('reconciles root and checked-out submodule origins to committed canonical URLs', async () => {
		const root = mkdtempSync(resolve(tmpdir(), 'organization-remotes-'));
		const child = resolve(root, 'starters/engineering');
		const legacyOwner = ['knowledge', 'coop'].join('-');
		const legacyTemplateOwner = ['treeseed', 'templates'].join('-');
		try {
			mkdirSync(child, { recursive: true });
			git(root, ['init', '--quiet']);
			git(child, ['init', '--quiet']);
			git(root, ['remote', 'add', 'origin', `git@github.com:${legacyOwner}/market.git`]);
			git(child, ['remote', 'add', 'origin', `git@github.com:${legacyTemplateOwner}/engineering.git`]);
			writeFileSync(resolve(root, 'package.json'), JSON.stringify({ repository: { url: 'https://github.com/treeseed-ai/market.git' } }));
			writeFileSync(resolve(root, '.gitmodules'), '[submodule "starters/engineering"]\n\tpath = starters/engineering\n\turl = git@github.com:treeseed-ai/template-engineering.git\n');

			const receipts = await reconcileLocalOrganizationRemotes(root);

			expect(receipts.map((receipt) => receipt.action)).toEqual(['update', 'update']);
			expect(git(root, ['remote', 'get-url', 'origin'])).toBe('git@github.com:treeseed-ai/market.git');
			expect(git(child, ['remote', 'get-url', 'origin'])).toBe('git@github.com:treeseed-ai/template-engineering.git');
			expect((await reconcileLocalOrganizationRemotes(root)).every((receipt) => receipt.action === 'noop')).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
