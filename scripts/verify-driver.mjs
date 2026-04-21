#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptRoot, '..');
const sourceRunner = resolve(packageRoot, 'scripts', 'run-ts.mjs');
const sourceEntry = resolve(packageRoot, 'src', 'verification.ts');
const publishedEntry = resolve(packageRoot, 'dist', 'verification.js');
const entrypointCheckOnly = process.env.TREESEED_VERIFY_ENTRYPOINT_CHECK === 'true';

if (existsSync(sourceRunner) && existsSync(sourceEntry)) {
	if (entrypointCheckOnly) {
		process.exit(0);
	}
	const result = spawnSync(process.execPath, [sourceRunner, sourceEntry], {
		cwd: process.cwd(),
		env: process.env,
		stdio: 'inherit',
	});
	process.exit(result.status ?? 1);
}

if (existsSync(publishedEntry)) {
	if (entrypointCheckOnly) {
		process.exit(0);
	}
	const { runTreeseedVerifyDriver } = await import('../dist/verification.js');
	process.exit(runTreeseedVerifyDriver({ packageRoot: process.cwd() }));
}

process.stderr.write(`Unable to locate Treeseed SDK verification runtime from ${packageRoot}.\n`);
process.exit(1);
