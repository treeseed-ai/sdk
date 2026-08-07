import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import type { PackageBootstrapAction, PackageBootstrapInput, PackageBootstrapResult } from './contracts.ts';
import { renderMetadataPackage } from './template.ts';

function git(args: string[], cwd: string, allowFailure = false) {
	try {
		return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
	} catch (error) {
		if (allowFailure) return null;
		const detail = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).trim() : String(error);
		throw new Error(`Git command failed (${args.join(' ')}): ${detail}`);
	}
}

function installLockfile(cwd: string) {
	try {
		execFileSync('npm', ['install', '--package-lock-only', '--workspaces=false', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	} catch (error) {
		const detail = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).trim() : String(error);
		throw new Error(`Package lock installation failed: ${detail}`);
	}
}

function normalizeRepository(value: string) {
	return value.trim().replace(/^git@github\.com:/u, '').replace(/^https:\/\/github\.com\//u, '').replace(/\.git$/u, '').toLowerCase();
}

function validateInput(input: PackageBootstrapInput) {
	if (!input.name.trim()) throw new Error('Package name is required.');
	if (!/^[a-z][a-z0-9-]*$/u.test(input.type)) throw new Error('Package type must be lowercase kebab-case.');
	if (input.kind !== 'node-typescript') throw new Error('Package bootstrap currently supports only node-typescript.');
	if (input.template !== 'metadata') throw new Error('Package bootstrap currently supports only the metadata template.');
	if (input.license !== 'Apache-2.0') throw new Error('Package bootstrap currently supports only Apache-2.0.');
	if (input.defaultBranch !== 'main') throw new Error('Package bootstrap requires main as the initial branch.');
	if (!/^@treeseed\/[a-z0-9-]+$/u.test(input.packageId)) throw new Error('Package id must be a lowercase @treeseed package name.');
	if (!/^[a-z0-9-]+\/[a-z0-9-]+$/u.test(input.repository)) throw new Error('Repository must use owner/name syntax.');
	if (!/^packages\/[a-z0-9-]+$/u.test(input.path) || isAbsolute(input.path)) throw new Error('Package target must be one direct lowercase packages/<name> path.');
	const root = resolve(input.workspaceRoot);
	const target = resolve(root, input.path);
	const packagesRoot = resolve(root, 'packages');
	if (target === packagesRoot || !target.startsWith(`${packagesRoot}${sep}`)) throw new Error('Package target escapes the workspace packages directory.');
	const remoteUrl = input.remoteUrl ?? `git@github.com:${input.repository}.git`;
	if (/github\.com/iu.test(remoteUrl) && normalizeRepository(remoteUrl) !== input.repository.toLowerCase()) throw new Error('Remote identity does not match the requested GitHub repository.');
	return { root, target, remoteUrl };
}

function nonempty(path: string) {
	return existsSync(path) && (!statSync(path).isDirectory() || readdirSync(path).length > 0);
}

function targetState(target: string, remoteUrl: string, expected: Record<string, string>) {
	if (!nonempty(target)) return { kind: 'absent' as const, sha: null };
	if (!existsSync(resolve(target, '.git'))) throw new Error(`Package target ${target} exists and is not a Git checkout.`);
	const origin = git(['remote', 'get-url', 'origin'], target);
	if (origin !== remoteUrl) throw new Error(`Package target origin ${origin} does not match ${remoteUrl}.`);
	const branch = git(['branch', '--show-current'], target);
	const head = git(['rev-parse', '--verify', 'HEAD'], target, true);
	if (!head) {
		if (branch !== 'main') throw new Error(`Interrupted package target is on ${branch || '(detached)'}, expected main.`);
		const unexpected = git(['status', '--porcelain', '--untracked-files=all'], target).split('\n').filter(Boolean).map((line) => line.slice(3)).filter((file) => expected[file] === undefined);
		const changed = Object.entries(expected).filter(([file, content]) => existsSync(resolve(target, file)) && readFileSync(resolve(target, file), 'utf8') !== content).map(([file]) => file);
		if (unexpected.length || changed.length) throw new Error(`Interrupted package target contains conflicting content: ${[...unexpected, ...changed].join(', ')}.`);
		return { kind: 'partial' as const, sha: null };
	}
	if (git(['status', '--porcelain'], target)) throw new Error(`Package target ${target} contains uncommitted changes.`);
	return { kind: 'checkout' as const, sha: head };
}

function remoteRefs(remoteUrl: string, root: string) {
	const output = git(['ls-remote', '--heads', '--tags', remoteUrl], root);
	return output ? output.split('\n').filter(Boolean) : [];
}

function registerSubmodule(root: string, packagePath: string, remoteUrl: string) {
	git(['config', '-f', '.gitmodules', `submodule.${packagePath}.path`, packagePath], root);
	git(['config', '-f', '.gitmodules', `submodule.${packagePath}.url`, remoteUrl], root);
	git(['add', '.gitmodules', packagePath], root);
	git(['submodule', 'absorbgitdirs', packagePath], root);
}

function actions(kind: 'absent' | 'partial' | 'checkout', packagePath: string, remoteUrl: string): PackageBootstrapAction[] {
	return kind !== 'checkout' ? [
		...(kind === 'absent' ? [{ kind: 'create_checkout' as const, target: packagePath }] : []), { kind: 'render_scaffold', target: packagePath },
		{ kind: 'install_lockfile', target: `${packagePath}/package-lock.json` }, { kind: 'commit', target: 'main' },
		{ kind: 'push', target: `${remoteUrl}#main` }, { kind: 'register_submodule', target: packagePath },
	] : [{ kind: 'register_submodule', target: packagePath }];
}

export function initializePackage(input: PackageBootstrapInput): PackageBootstrapResult {
	const { root, target, remoteUrl } = validateInput(input);
	const rendered = renderMetadataPackage(input);
	const files = Object.keys(rendered).sort();
	const local = targetState(target, remoteUrl, rendered);
	const refs = remoteRefs(remoteUrl, root);
	if (local.kind !== 'checkout' && refs.length > 0) throw new Error('Remote repository is not empty and cannot be initialized.');
	if (local.kind === 'checkout') {
		const remoteMain = git(['ls-remote', remoteUrl, 'refs/heads/main'], root)?.split(/\s+/u)[0] ?? null;
		if (!remoteMain || remoteMain !== local.sha) throw new Error('Existing checkout does not match the remote main branch.');
	}
	const planned = actions(local.kind, input.path, remoteUrl);
	if (!input.execute) return { mode: 'plan', status: 'planned', packageId: input.packageId, repository: input.repository, remoteUrl, path: input.path, branch: 'main', commitSha: local.sha, actions: planned, files };

	let commitSha = local.sha;
	let status: PackageBootstrapResult['status'] = local.kind === 'absent' ? 'created' : 'recovered';
	if (local.kind !== 'checkout') {
		if (local.kind === 'absent') {
			mkdirSync(target, { recursive: true });
			git(['init', '-b', 'main'], target);
			git(['remote', 'add', 'origin', remoteUrl], target);
		}
		for (const [file, content] of Object.entries(rendered)) {
			const destination = resolve(target, file);
			mkdirSync(dirname(destination), { recursive: true });
			writeFileSync(destination, content, 'utf8');
		}
		installLockfile(target);
		git(['add', '--all'], target);
		git(['-c', 'user.name=TreeSeed', '-c', 'user.email=opensource@treeseed.dev', 'commit', '-m', 'chore: initialize ai appliance package'], target);
		commitSha = git(['rev-parse', 'HEAD'], target);
		git(['push', '-u', 'origin', 'main'], target);
		const observed = git(['ls-remote', remoteUrl, 'refs/heads/main'], root)?.split(/\s+/u)[0] ?? null;
		if (observed !== commitSha) throw new Error('Remote main did not match the initialized package commit.');
	}
	const registeredPath = git(['config', '-f', '.gitmodules', '--get', `submodule.${input.path}.path`], root, true);
	const registeredUrl = git(['config', '-f', '.gitmodules', '--get', `submodule.${input.path}.url`], root, true);
	if (registeredPath && (registeredPath !== input.path || registeredUrl !== remoteUrl)) throw new Error('Existing submodule registration conflicts with the requested package.');
	if (!registeredPath) registerSubmodule(root, input.path, remoteUrl);
	else status = 'unchanged';
	return { mode: 'execute', status, packageId: input.packageId, repository: input.repository, remoteUrl, path: input.path, branch: 'main', commitSha, actions: planned, files };
}
