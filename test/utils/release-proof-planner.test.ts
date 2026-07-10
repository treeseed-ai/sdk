import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTreeseedProofPlan, hostedWorkflowForPackage } from '../../src/operations/services/release-proof-planner.ts';
import { discoverTreeseedPackageAdapters } from '../../src/operations/services/package-adapters.ts';

const roots: string[] = [];

function runGit(cwd: string, args: string[]) {
	const result = spawnSync('git', args, {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, GIT_ALLOW_PROTOCOL: process.env.GIT_ALLOW_PROTOCOL ?? 'file:git:ssh:https' },
	});
	if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
	return result.stdout.trim();
}

function makeWorkspace() {
	const tempRoot = resolve('.treeseed', 'test-tmp');
	mkdirSync(tempRoot, { recursive: true });
	const root = mkdtempSync(join(tempRoot, 'proof-plan-'));
	roots.push(root);
	const pkg = resolve(root, 'packages', 'sdk');
	mkdirSync(resolve(pkg, '.github', 'workflows'), { recursive: true });
	writeFileSync(resolve(root, 'package.json'), JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] }, null, 2), 'utf8');
	writeFileSync(resolve(pkg, 'package.json'), JSON.stringify({
		name: '@treeseed/sdk',
		version: '1.0.0',
		scripts: {
			'verify:local': 'node -e "process.exit(0)"',
			'verify:action': 'node -e "process.exit(0)"',
		},
	}, null, 2), 'utf8');
	writeFileSync(resolve(pkg, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {} }, null, 2), 'utf8');
	writeFileSync(resolve(pkg, 'treeseed.package.yaml'), `id: '@treeseed/sdk'
name: '@treeseed/sdk'
kind: node-typescript
repository: treeseed-ai/sdk
hostedVerifyWorkflow: .github/workflows/release-gate.yml
releaseGate:
  timeoutSeconds: 7200
verify:
  local: npm run verify:local
`, 'utf8');
	writeFileSync(resolve(pkg, '.github', 'workflows', 'release-gate.yml'), 'name: Release Gate\n', 'utf8');
	runGit(root, ['init']);
	runGit(root, ['config', 'user.email', 'test@example.com']);
	runGit(root, ['config', 'user.name', 'Test User']);
	runGit(root, ['add', '.']);
	runGit(root, ['commit', '-m', 'init']);
	runGit(root, ['checkout', '-b', 'staging']);
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('release proof planner', () => {
	it('plans authoritative GitHub-hosted package proof from package manifests', () => {
		const root = makeWorkspace();
		const adapters = discoverTreeseedPackageAdapters(root);
		expect(hostedWorkflowForPackage(adapters[0]!)).toBe('release-gate.yml');
		expect(adapters[0]?.metadata.hostedVerifyTimeoutSeconds).toBe(7200);

		const plan = buildTreeseedProofPlan({ root, target: 'staging', driver: 'github-hosted' });
		expect(plan.summary.subjects).toBe(1);
		expect(plan.summary.reusable).toBe(0);
		expect(plan.subjects[0]).toMatchObject({
			workflow: 'release-gate.yml',
			authority: 'authoritative',
			subject: {
				id: 'package:@treeseed/sdk',
				repository: 'treeseed-ai/sdk',
				branch: 'staging',
			},
		});
		expect(plan.subjects[0]?.inputs.workflowHash).toBeTruthy();
	});

	it('marks act proof as advisory', () => {
		const root = makeWorkspace();
		const plan = buildTreeseedProofPlan({ root, target: 'staging', driver: 'act', subject: 'package:@treeseed/sdk' });
		expect(plan.subjects).toHaveLength(1);
		expect(plan.subjects[0]?.authority).toBe('advisory');
		expect(plan.subjects[0]?.workflow).toBeNull();
		expect(plan.subjects[0]?.command).toBeTruthy();
	});
});
