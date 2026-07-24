import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, renameSync, chmodSync, copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { platform as osPlatform, arch as osArch } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { withServiceCredentialEnv } from '../configuration/service-credentials.ts';
import { createManagedToolEnv, managedGhBin, managedRailwayBin, tokenEnv } from './dependency-runtime.ts';
import type { DependencyInstallerOptions, DependencyInstallResult, ManagedToolName, NpmInstallReport, ToolInvocation, ToolStatusResult } from './dependency-runtime.ts';
import { npmToolsMissingRuntime, resolveNpmRebuildCommand } from './collect-native-dependency-repairs.ts';
import { findNpmTool, locateSystemBinary, redactSensitiveOutput, resolveNpmToolRuntimeBinary } from './redact-sensitive-output.ts';

export function runNpmToolRebuilds(options: Required<Pick<DependencyInstallerOptions, 'env' | 'spawn'>> & Pick<DependencyInstallerOptions, 'tenantRoot' | 'write'>): NpmInstallReport[] {
	const missingRuntimeTools = npmToolsMissingRuntime();
	if (missingRuntimeTools.length === 0) {
		return [];
	}
	const tenantRoot = options.tenantRoot ? resolve(options.tenantRoot) : null;
	const npmCommand = resolveNpmRebuildCommand(options.env, missingRuntimeTools.map((tool) => tool.packageName));
	if (!tenantRoot || !existsSync(resolve(tenantRoot, 'package.json'))) {
		return [{
			root: tenantRoot,
			command: npmCommand.display,
			status: 'skipped',
			exitCode: null,
			detail: tenantRoot ? `No package.json found in ${tenantRoot}; npm rebuild skipped.` : 'No tenant root was provided; npm rebuild skipped.',
		}];
	}
	if (options.env.TREESEED_MANAGED_NPM_INSTALL === '1') {
		return [{
			root: tenantRoot,
			command: npmCommand.display,
			status: 'skipped',
			exitCode: null,
			detail: 'npm rebuild skipped because TREESEED_MANAGED_NPM_INSTALL=1 is set.',
		}];
	}

	options.write?.(`Rebuilding npm-backed Treeseed tools in ${tenantRoot}...`);
	const result = options.spawn(npmCommand.command, npmCommand.args, {
		cwd: tenantRoot,
		env: {
			...options.env,
			TREESEED_MANAGED_NPM_INSTALL: '1',
		},
		stdio: 'pipe',
		encoding: 'utf8',
	});
	const detail = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim() || result.error?.message || '';
	const stillMissing = npmToolsMissingRuntime().map((tool) => tool.packageName);
	const ok = result.status === 0 && !result.error && stillMissing.length === 0;
	return [{
		root: tenantRoot,
		command: npmCommand.display,
		status: ok ? 'installed' : 'failed',
		exitCode: result.status ?? (ok ? 0 : 1),
		detail: ok
			? detail || 'npm-backed Treeseed tools rebuilt successfully.'
			: [
				detail || 'npm-backed Treeseed tool rebuild failed.',
				stillMissing.length > 0 ? `Missing runtime tools after rebuild: ${stillMissing.join(', ')}` : '',
			].filter(Boolean).join('\n'),
	}];
}

export function formatDependencyFailureDetails(result: Pick<DependencyInstallResult, 'npmInstalls' | 'reports'>) {
	const npmFailures = result.npmInstalls
		.filter((entry) => entry.status === 'failed')
		.map((entry) => {
			const root = entry.root ?? 'no tenant root';
			const exit = entry.exitCode === null ? 'unknown exit code' : `exit code ${entry.exitCode}`;
			const operation = entry.command.includes('rebuild') ? 'npm rebuild' : 'npm install';
			return `${operation} in ${root}: ${entry.command.join(' ')} failed with ${exit}${entry.detail ? `: ${entry.detail}` : ''}`;
		});
	const toolFailures = result.reports
		.filter((entry) => entry.required && ['failed', 'missing', 'unsupported'].includes(entry.status))
		.map((entry) => `${entry.name}: ${entry.detail}`);
	return [...npmFailures, ...toolFailures].join('\n- ') || 'No dependency failure details were reported.';
}

export function resolveToolBinary(toolName: ManagedToolName, options: { env?: NodeJS.ProcessEnv } = {}) {
	if (toolName === 'gh') {
		const managed = managedGhBin(options.env);
		if (existsSync(managed)) {
			return managed;
		}
		return locateSystemBinary('gh', spawnSync, options.env ?? process.env);
	}
	if (toolName === 'railway') {
		const managed = managedRailwayBin(options.env);
		return existsSync(managed) ? managed : null;
	}
	const npmTool = findNpmTool(toolName);
	if (npmTool) {
		return resolveNpmToolRuntimeBinary(npmTool);
	}
	if (toolName === 'git' || toolName === 'docker') {
		return locateSystemBinary(toolName, spawnSync, options.env ?? process.env);
	}
	return null;
}

export function resolveToolCommand(toolName: ManagedToolName, options: { env?: NodeJS.ProcessEnv } = {}) {
	const binaryPath = resolveToolBinary(toolName, options);
	if (!binaryPath) {
		return null;
	}
	if (findNpmTool(toolName) && /\.(?:cjs|mjs|js)$/u.test(binaryPath)) {
		return { command: process.execPath, argsPrefix: [binaryPath], binaryPath };
	}
	return { command: binaryPath, argsPrefix: [], binaryPath };
}

export function invocationForTool(toolName: ManagedToolName, env: NodeJS.ProcessEnv = process.env): ToolInvocation {
	const command = resolveToolCommand(toolName, { env });
	if (!command) {
		return {
			mode: 'unavailable',
			command: null,
			argsPrefix: [],
			binaryPath: null,
		};
	}
	return {
		mode: findNpmTool(toolName) && /\.(?:cjs|mjs|js)$/u.test(command.binaryPath) ? 'node' : 'direct',
		command: command.command,
		argsPrefix: command.argsPrefix,
		binaryPath: command.binaryPath,
	};
}

export function checkGitHubAuth(options: DependencyInstallerOptions): ToolStatusResult['auth']['github'] {
	const env = tokenEnv(options.env ?? process.env);
	const gh = resolveToolCommand('gh', { env });
	const command = gh ? [gh.command, ...gh.argsPrefix, 'auth', 'status', '--hostname', 'github.com'] : [];
	const remediation = [
		'Run `npx trsd install --json` to install or inspect managed tools.',
		'Run `npx trsd secrets:unlock` or provide TREESEED_KEY_PASSPHRASE so machine secrets can be decrypted.',
		'Verify TREESEED_GITHUB_TOKEN is configured in machine.yaml or the environment.',
	];
	if (!gh) {
		return {
			checked: true,
			authenticated: false,
			binaryPath: null,
			command,
			detail: 'GitHub CLI `gh` is unavailable.',
			remediation,
		};
	}
	const result = (options.spawn ?? spawnSync)(gh.command, [...gh.argsPrefix, 'auth', 'status', '--hostname', 'github.com'], {
		cwd: options.tenantRoot,
		env: createManagedToolEnv(env),
		stdio: 'pipe',
		encoding: 'utf8',
		timeout: 15000,
	});
	const detail = redactSensitiveOutput(`${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim())
		|| (result.status === 0 ? 'GitHub CLI authentication succeeded.' : 'GitHub CLI authentication failed.');
	return {
		checked: true,
		authenticated: result.status === 0,
		binaryPath: gh.binaryPath,
		command,
		detail,
		remediation,
	};
}

export async function defaultDownloadFile(url: string, targetPath: string): Promise<void> {
	const request = url.startsWith('https:') ? httpsRequest : httpRequest;
	await new Promise<void>((resolvePromise, rejectPromise) => {
		const req = request(url, (response) => {
			const status = response.statusCode ?? 0;
			const location = response.headers.location;
			if (status >= 300 && status < 400 && location) {
				response.resume();
				defaultDownloadFile(new URL(location, url).toString(), targetPath).then(resolvePromise, rejectPromise);
				return;
			}
			if (status < 200 || status >= 300) {
				response.resume();
				rejectPromise(new Error(`Download failed (${status}) for ${url}`));
				return;
			}
			mkdirSync(dirname(targetPath), { recursive: true });
			const output = createWriteStream(targetPath);
			response.pipe(output);
			output.on('finish', () => {
				output.close();
				resolvePromise();
			});
			output.on('error', rejectPromise);
		});
		req.on('error', rejectPromise);
		req.end();
	});
}

export function parseChecksums(contents: string, assetName: string) {
	for (const line of contents.split(/\r?\n/u)) {
		const [hash, name] = line.trim().split(/\s+/u);
		if (name === assetName && /^[a-f0-9]{64}$/iu.test(hash ?? '')) {
			return hash.toLowerCase();
		}
	}
	return null;
}

export function findExtractedGhBinary(root: string): string | null {
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const fullPath = resolve(root, entry.name);
		if (entry.isDirectory()) {
			const found = findExtractedGhBinary(fullPath);
			if (found) return found;
			continue;
		}
		if (entry.isFile() && basename(fullPath) === 'gh' && basename(dirname(fullPath)) === 'bin') {
			return fullPath;
		}
	}
	return null;
}
