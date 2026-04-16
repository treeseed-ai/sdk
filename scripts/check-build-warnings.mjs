#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const allowlisted = [];
const files = [];

for (let index = 0; index < args.length; index += 1) {
	const arg = args[index];
	if (arg === '--allow') {
		const pattern = args[index + 1];
		if (!pattern) {
			throw new Error('Missing value for --allow.');
		}
		allowlisted.push(new RegExp(pattern));
		index += 1;
		continue;
	}
	files.push(arg);
}

if (files.length === 0) {
	throw new Error('Usage: node check-build-warnings.mjs <log-file> [<log-file> ...] [--allow <regex>]');
}

const warningLines = [];
for (const file of files) {
	const contents = readFileSync(resolve(process.cwd(), file), 'utf8');
	for (const line of contents.split(/\r?\n/u)) {
		if (!line.includes('[WARN]')) {
			continue;
		}
		if (allowlisted.some((pattern) => pattern.test(line))) {
			continue;
		}
		warningLines.push(line);
	}
}

if (warningLines.length > 0) {
	console.error('Unexpected build warnings detected:');
	for (const line of warningLines) {
		console.error(`- ${line}`);
	}
	process.exit(1);
}

console.log('No unexpected build warnings detected.');
