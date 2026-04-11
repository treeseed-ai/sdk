import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { createTempDir } from './workspace-tools.ts';

function runCapture(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? process.cwd(),
		env: { ...process.env, ...(options.env ?? {}) },
		stdio: 'pipe',
		encoding: 'utf8',
		timeout: options.timeoutMs,
	});

	return {
		status: result.status ?? 1,
		signal: result.signal ?? null,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
		error: result.error?.message ?? null,
	};
}

function locateBinary(candidate) {
	const result = runCapture('bash', ['-lc', `command -v ${candidate}`]);
	return result.status === 0 ? result.stdout.trim() : null;
}

export function createWranglerCommandEnv(overrides = {}) {
	const configHome = createTempDir('treeseed-wrangler-config-');
	const logDir = resolve(configHome, '.wrangler', 'logs');
	mkdirSync(logDir, { recursive: true });
	return {
		XDG_CONFIG_HOME: configHome,
		WRANGLER_SEND_METRICS: 'false',
		...overrides,
	};
}

function envTokenStatus(keys, label) {
	const foundKey = keys.find((key) => {
		const value = process.env[key];
		return typeof value === 'string' && value.trim().length > 0;
	}) ?? null;

	return {
		ready: Boolean(foundKey),
		detail: foundKey
			? `${label} token detected from ${foundKey}.`
			: `${label} token is not configured. Set ${keys.join(' or ')}.`,
		source: foundKey ? 'env' : 'missing',
	};
}

export function parseGitHubAuthStatus() {
	return {
		authenticated: envTokenStatus(['GH_TOKEN'], 'GitHub').ready,
		detail: envTokenStatus(['GH_TOKEN'], 'GitHub').detail,
	};
}

export function parseWranglerWhoAmI() {
	return {
		authenticated: envTokenStatus(['CLOUDFLARE_API_TOKEN'], 'Cloudflare').ready,
		detail: envTokenStatus(['CLOUDFLARE_API_TOKEN'], 'Cloudflare').detail,
	};
}

export function parseRailwayWhoAmI() {
	return {
		authenticated: envTokenStatus(['RAILWAY_API_TOKEN'], 'Railway').ready,
		detail: envTokenStatus(['RAILWAY_API_TOKEN'], 'Railway').detail,
	};
}

export function parseCopilotSessionStatus() {
	const status = envTokenStatus(['GH_TOKEN'], 'GitHub');
	return {
		configured: status.ready,
		detail: status.ready
			? 'GitHub token detected from GH_TOKEN for Copilot-backed workflows.'
			: 'GitHub token is not configured. Set GH_TOKEN for Copilot-backed workflows.',
	};
}

export function collectCliPreflight({ cwd = process.cwd(), requireAuth = false } = {}) {
	const binaries = {
		git: locateBinary('git'),
		npm: locateBinary('npm'),
		gh: locateBinary('gh'),
		wrangler: locateBinary('wrangler'),
		railway: locateBinary('railway'),
		copilot: locateBinary('copilot'),
	};

	const checks = {
		commands: Object.fromEntries(
			Object.entries(binaries).map(([name, path]) => [name, {
				installed: Boolean(path),
				path,
			}]),
		),
		auth: {},
	};

	if (binaries.gh) {
		checks.auth.gh = parseGitHubAuthStatus();
	} else {
		checks.auth.gh = { authenticated: false, detail: 'GitHub CLI is not installed.' };
	}

	if (binaries.wrangler) {
		checks.auth.wrangler = parseWranglerWhoAmI();
	} else {
		checks.auth.wrangler = { authenticated: false, detail: 'Wrangler CLI is not installed.' };
	}

	if (binaries.railway) {
		checks.auth.railway = parseRailwayWhoAmI();
	} else {
		checks.auth.railway = { authenticated: false, detail: 'Railway CLI is not installed.' };
	}

	if (binaries.copilot) {
		checks.auth.copilot = parseCopilotSessionStatus();
	} else {
		checks.auth.copilot = { configured: false, detail: 'Copilot CLI is not installed.' };
	}

	const missingCommands = Object.entries(checks.commands)
		.filter(([, value]) => !value.installed)
		.map(([name]) => name);
	const failingAuth = [];

	if (requireAuth) {
		if (!checks.auth.gh?.authenticated) failingAuth.push('gh');
		if (!checks.auth.wrangler?.authenticated) failingAuth.push('wrangler');
		if (!checks.auth.railway?.authenticated) failingAuth.push('railway');
	}

	return {
		ok: missingCommands.length === 0 && failingAuth.length === 0,
		requireAuth,
		missingCommands,
		failingAuth,
		checks,
	};
}

export function formatCliPreflightReport(report) {
	const lines = [
		'Treeseed preflight summary',
		`Status: ${report.ok ? 'ok' : 'failed'}`,
		`Require auth: ${report.requireAuth ? 'yes' : 'no'}`,
		'Commands:',
	];

	for (const [name, info] of Object.entries(report.checks.commands)) {
		lines.push(`- ${name}: ${info.installed ? `installed (${info.path})` : 'missing'}`);
	}

	lines.push('Auth/session:');
	lines.push(`- gh: ${report.checks.auth.gh?.authenticated ? 'authenticated' : 'not authenticated'}`);
	lines.push(`  ${report.checks.auth.gh?.detail ?? ''}`.trimEnd());
	lines.push(`- wrangler: ${report.checks.auth.wrangler?.authenticated ? 'authenticated' : 'not authenticated'}`);
	lines.push(`  ${report.checks.auth.wrangler?.detail ?? ''}`.trimEnd());
	lines.push(`- railway: ${report.checks.auth.railway?.authenticated ? 'authenticated' : 'not authenticated'}`);
	lines.push(`  ${report.checks.auth.railway?.detail ?? ''}`.trimEnd());
	lines.push(`- copilot: ${report.checks.auth.copilot?.configured ? 'configured' : 'not configured'}`);
	lines.push(`  ${report.checks.auth.copilot?.detail ?? ''}`.trimEnd());

	if (report.missingCommands.length > 0) {
		lines.push(`Missing commands: ${report.missingCommands.join(', ')}`);
	}
	if (report.failingAuth.length > 0) {
		lines.push(`Auth failures: ${report.failingAuth.join(', ')}`);
	}

	return lines.filter(Boolean).join('\n');
}

export function writeJsonArtifact(filePath, value) {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
