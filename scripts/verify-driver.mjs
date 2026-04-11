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

if (existsSync(sourceRunner) && existsSync(sourceEntry)) {
	const result = spawnSync(process.execPath, [sourceRunner, sourceEntry], {
		cwd: process.cwd(),
		env: process.env,
		stdio: 'inherit',
	});
	process.exit(result.status ?? 1);
}

if (existsSync(publishedEntry)) {
	const { runTreeseedVerifyDriver } = await import('../dist/verification.js');
	process.exit(runTreeseedVerifyDriver({ packageRoot: process.cwd() }));
}

process.stderr.write(`Unable to locate Treeseed SDK verification runtime from ${packageRoot}.\n`);
process.exit(1);
