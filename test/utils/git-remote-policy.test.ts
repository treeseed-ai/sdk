import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	configuredPushUrl,
	ensureSshPushUrlForOrigin,
	remoteWriteUrl,
	sshPushUrlForRemote,
} from '../../src/operations/services/git-remote-policy.ts';
import { run } from '../../src/operations/services/workspace-tools.ts';

const roots: string[] = [];

function testTempBase() {
	const base = join(process.cwd(), '.treeseed', 'test-tmp');
	mkdirSync(base, { recursive: true });
	return base;
}

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe('git remote policy', () => {
	it('derives SSH push URLs from public HTTPS remotes', () => {
		expect(sshPushUrlForRemote('https://github.com/treeseed-ai/sdk.git')).toBe('git@github.com:treeseed-ai/sdk.git');
		expect(sshPushUrlForRemote('git+https://github.com/treeseed-ai/sdk.git')).toBe('git@github.com:treeseed-ai/sdk.git');
		expect(sshPushUrlForRemote('git@github.com:treeseed-ai/sdk.git')).toBeNull();
		expect(sshPushUrlForRemote('file:///tmp/sdk.git')).toBeNull();
	});

	it('keeps the read URL and configures only the push URL', () => {
		const repo = mkdtempSync(join(testTempBase(), 'treeseed-remote-policy-'));
		roots.push(repo);
		run('git', ['init'], { cwd: repo });
		run('git', ['remote', 'add', 'origin', 'https://github.com/treeseed-ai/sdk.git'], { cwd: repo });

		const result = ensureSshPushUrlForOrigin(repo, 'https://github.com/treeseed-ai/sdk.git');

		expect(result.changed).toBe(true);
		expect(run('git', ['remote', 'get-url', 'origin'], { cwd: repo, capture: true }).trim()).toBe('https://github.com/treeseed-ai/sdk.git');
		expect(configuredPushUrl(repo)).toBe('git@github.com:treeseed-ai/sdk.git');
		expect(remoteWriteUrl(repo)).toBe('git@github.com:treeseed-ai/sdk.git');
	});
});
