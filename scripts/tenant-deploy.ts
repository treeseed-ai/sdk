#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { applyTreeseedEnvironmentToProcess } from '../src/operations/services/config-runtime.ts';
import {
	assertDeploymentInitialized,
	createBranchPreviewDeployTarget,
	createPersistentDeployTarget,
	deployTargetLabel,
	ensureGeneratedWranglerConfig,
	finalizeDeploymentState,
	loadDeployState,
	runRemoteD1Migrations,
} from '../src/operations/services/deploy.ts';
import {
	prepareTenantCloudflareDeploy,
	runTenantDataMigration,
	runTenantWebBuild,
	runTenantWebPublish,
} from '../src/operations/services/project-platform.ts';
import { currentManagedBranch, PRODUCTION_BRANCH, STAGING_BRANCH } from '../src/operations/services/git-workflow.ts';
import { loadCliDeployConfig, packageScriptPath, resolveWranglerBin } from '../src/operations/services/runtime-tools.ts';
import { runTenantDeployPreflight } from '../src/operations/services/save-deploy-preflight.ts';

const tenantRoot = process.cwd();
const args = process.argv.slice(2);

function writeDeployReport(payload) {
	const target = process.env.TREESEED_DEPLOY_REPORT_PATH;
	if (!target) {
		return;
	}

	const filePath = resolve(target);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function parseArgs(argv) {
	const parsed = {
		dryRun: false,
		only: null,
		name: null,
		environment: null,
		targetBranch: null,
	};

	const rest = [...argv];
	while (rest.length) {
		const current = rest.shift();
		if (!current) continue;
		if (current === '--dry-run') {
			parsed.dryRun = true;
			continue;
		}
		if (current === '--only') {
			parsed.only = rest.shift() ?? null;
			continue;
		}
		if (current === '--name') {
			parsed.name = rest.shift() ?? null;
			continue;
		}
		if (current === '--environment') {
			parsed.environment = rest.shift() ?? null;
			continue;
		}
		if (current.startsWith('--environment=')) {
			parsed.environment = current.split('=', 2)[1] ?? null;
			continue;
		}
		if (current === '--target-branch') {
			parsed.targetBranch = rest.shift() ?? null;
			continue;
		}
		if (current.startsWith('--target-branch=')) {
			parsed.targetBranch = current.split('=', 2)[1] ?? null;
			continue;
		}
		throw new Error(`Unknown deploy argument: ${current}`);
	}

	return parsed;
}

function inferEnvironmentFromBranch() {
	const branch = currentManagedBranch(tenantRoot);
	if (branch === STAGING_BRANCH) {
		return 'staging';
	}
	if (branch === PRODUCTION_BRANCH) {
		return 'prod';
	}
	return null;
}

function resolveTarget(options) {
	if (options.targetBranch) {
		return {
			target: createBranchPreviewDeployTarget(options.targetBranch),
			scope: 'staging',
		};
	}

	const environment = options.environment ?? (process.env.CI ? inferEnvironmentFromBranch() : null);
	if (!environment) {
		throw new Error('Treeseed deploy requires `--environment local|staging|prod` outside CI.');
	}

	return {
		target: createPersistentDeployTarget(environment),
		scope: environment,
	};
}

function runNodeScript(scriptPath, scriptArgs = [], env = {}) {
	const result = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
		stdio: 'inherit',
		cwd: tenantRoot,
		env: { ...process.env, ...env },
	});

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function isTransientWranglerFailure(result) {
	const output = [result.stderr, result.stdout]
		.filter((value) => typeof value === 'string' && value.trim().length > 0)
		.join('\n');
	return /fetch failed|timed out|etimedout|econnreset|enetunreach|temporarily unavailable|connectivity issue|internal error/i.test(output);
}

function sleepSync(milliseconds) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function runWranglerDeploy(configPath) {
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		const result = spawnSync(process.execPath, [resolveWranglerBin(), 'deploy', '--config', configPath], {
			stdio: 'inherit',
			cwd: tenantRoot,
			env: { ...process.env },
		});
		if (result.status === 0) {
			return;
		}
		if (attempt === 3 || !isTransientWranglerFailure(result)) {
			process.exit(result.status ?? 1);
		}
		sleepSync(2000 * attempt);
	}
}

function runWranglerPagesDeploy(projectName, branchName, outputDir = 'dist') {
	const args = [
		resolveWranglerBin(),
		'pages',
		'deploy',
		outputDir,
		'--project-name',
		projectName,
	];

	if (branchName) {
		args.push('--branch', branchName);
	}

	for (let attempt = 1; attempt <= 3; attempt += 1) {
		const result = spawnSync(process.execPath, args, {
			stdio: 'inherit',
			cwd: tenantRoot,
			env: { ...process.env },
		});
		if (result.status === 0) {
			return;
		}
		if (attempt === 3 || !isTransientWranglerFailure(result)) {
			process.exit(result.status ?? 1);
		}
		sleepSync(2000 * attempt);
	}
}

async function main() {
	const options = parseArgs(args);
	const { target, scope } = resolveTarget(options);
	applyTreeseedEnvironmentToProcess({ tenantRoot, scope, override: true });

	const allowedSteps = new Set(['migrate', 'build', 'publish']);
	if (options.only && !allowedSteps.has(options.only)) {
		throw new Error(`Unsupported deploy step "${options.only}". Expected one of ${[...allowedSteps].join(', ')}.`);
	}

	const shouldRun = (step) => !options.only || options.only === step;
	if (options.name) {
		console.log(`Deploy target label: ${options.name}`);
	}

	if (scope === 'local') {
		runTenantDeployPreflight({ cwd: tenantRoot, scope: 'local' });
		await runTenantWebBuild({ tenantRoot, scope: 'local', dryRun: options.dryRun, env: process.env });
		writeDeployReport({ ok: true, kind: 'success', scope, dryRun: options.dryRun, target: deployTargetLabel(target) });
		console.log('Treeseed local deploy completed as a build-only publish target.');
		return;
	}

	let context;
	try {
		context = prepareTenantCloudflareDeploy({
			tenantRoot,
			scope,
			target,
			dryRun: options.dryRun,
			env: process.env,
		});
	} catch (error) {
		writeDeployReport({
			ok: false,
			kind: 'preflight_failed',
			target: deployTargetLabel(target),
			message: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}

	if (shouldRun('migrate')) {
		const result = await runTenantDataMigration(context);
		console.log(`${options.dryRun ? 'Planned' : 'Applied'} remote migrations for ${result.databaseName}.`);
	}

	if (shouldRun('build')) {
		await runTenantWebBuild(context);
	}

	if (shouldRun('publish')) {
		await runTenantWebPublish(context);
		if (!options.dryRun) {
			finalizeDeploymentState(tenantRoot, { target });
		}
	}

	writeDeployReport({
		ok: true,
		kind: 'success',
		dryRun: options.dryRun,
		only: options.only,
		target: deployTargetLabel(target),
	});
}

try {
	await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
