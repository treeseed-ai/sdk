#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
function resolvePackageRoot(start: string) {
	let current = start;
	for (;;) {
		const manifestPath = resolve(current, 'package.json');
		if (existsSync(manifestPath)) {
			const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string };
			if (manifest.name === '@treeseed/sdk') return current;
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	throw new Error(`Unable to locate SDK package root from ${start}.`);
}

const packageRoot = resolvePackageRoot(scriptRoot);
const sourceEntry = resolve(packageRoot, 'src', 'verification', 'run-verify-driver.ts');
const publishedEntry = resolve(packageRoot, 'dist', 'verification', 'run-verify-driver.js');
const entrypointCheckOnly = process.env.TREESEED_VERIFY_ENTRYPOINT_CHECK === 'true';

const runtimeEntry = existsSync(sourceEntry)
	? sourceEntry
	: existsSync(publishedEntry)
		? publishedEntry
		: null;
if (runtimeEntry) {
	if (entrypointCheckOnly) {
		process.exit(0);
	}
	const { runVerifyDriver } = await import(pathToFileURL(runtimeEntry).href);
	process.exit(runVerifyDriver({ packageRoot: process.cwd() }));
}

process.stderr.write(`Unable to locate Treeseed SDK verification runtime from ${packageRoot}.\n`);
process.exit(1);
