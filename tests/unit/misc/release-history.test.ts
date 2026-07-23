import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
	collectReleaseHistoryCommits,
	renderAdministrativeCommitMessage,
	upsertReleaseChangelog,
} from '../../../src/operations/services/release-history.ts';

function git(cwd: string, args: string[]) {
	const result = spawnSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `git ${args.join(' ')} failed`);
	}
	return result.stdout.trim();
}

function makeRepo() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-release-history-'));
	git(root, ['init', '-b', 'main']);
	git(root, ['config', 'user.name', 'Treeseed Test']);
	git(root, ['config', 'user.email', 'treeseed@example.com']);
	writeFileSync(resolve(root, 'README.md'), '# Demo\n', 'utf8');
	git(root, ['add', '-A']);
	git(root, ['commit', '-m', 'init']);
	git(root, ['checkout', '-b', 'staging']);
	writeFileSync(resolve(root, 'feature.txt'), 'feature\n', 'utf8');
	git(root, ['add', '-A']);
	git(root, ['commit', '-m', 'feat: add release history']);
	writeFileSync(resolve(root, 'fix.txt'), 'fix\n', 'utf8');
	git(root, ['add', '-A']);
	git(root, ['commit', '-m', 'fix: repair release status']);
	return root;
}

describe('release history helpers', () => {
	it('collects promoted commits and prepends Keep a Changelog entries', () => {
		const root = makeRepo();
		const commits = collectReleaseHistoryCommits(root, 'main', 'staging');
		const summary = upsertReleaseChangelog(root, {
			version: '1.2.3',
			sourceRef: 'staging',
			targetRef: 'main',
			commits,
		});

		const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
		expect(summary.changelogUpdated).toBe(true);
		expect(changelog.startsWith('# Changelog\n\n## [1.2.3]')).toBe(true);
		expect(changelog).toContain('### Added');
		expect(changelog).toContain('feat: add release history');
		expect(changelog).toContain('### Fixed');
		expect(changelog).toContain('fix: repair release status');
	});

	it('renders administrative commit messages with promoted change context', () => {
		const root = makeRepo();
		const commits = collectReleaseHistoryCommits(root, 'main', 'staging');
		const changelog = upsertReleaseChangelog(root, {
			version: '1.2.3',
			sourceRef: 'staging',
			targetRef: 'main',
			commits,
		});

		const message = renderAdministrativeCommitMessage({
			subject: 'release: staging -> main',
			version: '1.2.3',
			tagName: '1.2.3',
			sourceRef: 'staging',
			targetRef: 'main',
			commits,
			changelog,
		});

		expect(message).toContain('Release summary:');
		expect(message).toContain('- Version: 1.2.3');
		expect(message).toContain('- Promoted commits: 2');
		expect(message).toContain('feat: add release history');
		expect(message).toContain('See CHANGELOG.md');
	});
});
