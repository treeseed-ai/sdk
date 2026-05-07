#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	formatAllowedBuildWarnings,
	scanBuildWarningText,
} from '../src/operations/services/build-warning-policy.js';

const args = process.argv.slice(2);
const allowlisted = [];
const files = [];
let useDefaultPolicy = true;

for (let index = 0; index < args.length; index += 1) {
	const arg = args[index];
	if (arg === '--no-default-policy') {
		useDefaultPolicy = false;
		continue;
	}
	if (arg === '--allow') {
		const pattern = args[index + 1];
		if (!pattern) {
			throw new Error('Missing value for --allow.');
		}
		allowlisted.push(pattern);
		index += 1;
		continue;
	}
	files.push(arg);
}

if (files.length === 0) {
	throw new Error('Usage: node check-build-warnings.mjs <log-file> [<log-file> ...] [--allow <regex>] [--no-default-policy]');
}

const warningLines = [];
const allowedWarnings = new Map();
for (const file of files) {
	const contents = readFileSync(resolve(process.cwd(), file), 'utf8');
	const scan = scanBuildWarningText(contents, {
		useDefaultPolicy,
		allow: allowlisted,
	});
	for (const [label, count] of scan.allowedWarnings.entries()) {
		allowedWarnings.set(label, (allowedWarnings.get(label) ?? 0) + count);
	}
	warningLines.push(...scan.unexpectedWarnings);
}

if (warningLines.length > 0) {
	console.error('Unexpected build warnings detected:');
	for (const line of warningLines) {
		console.error(`- ${line}`);
	}
	process.exit(1);
}

for (const line of formatAllowedBuildWarnings(allowedWarnings)) {
	console.log(line);
}
console.log('No unexpected build warnings detected.');
