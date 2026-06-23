#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptRoot, '..');
const sourceEntry = resolve(packageRoot, 'src', 'verification.ts');
const publishedEntry = resolve(packageRoot, 'dist', 'verification.js');
const entrypointCheckOnly = process.env.TREESEED_VERIFY_ENTRYPOINT_CHECK === 'true';

function withShortTempEnv() {
	if (process.platform === 'win32') {
		return process.env;
	}
	const env = { ...process.env };
	const shortTemp = tmpdir();
	for (const key of ['TMPDIR', 'TMP', 'TEMP'] as const) {
		const value = env[key];
		if (value && value.length > shortTemp.length) {
			env[key] = shortTemp;
		}
	}
	return env;
}

if (existsSync(sourceEntry)) {
	if (entrypointCheckOnly) {
		process.exit(0);
	}
	const result = spawnSync('tsx', [sourceEntry], {
		cwd: process.cwd(),
		env: withShortTempEnv(),
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
