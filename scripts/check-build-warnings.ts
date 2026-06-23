#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import {
	formatAllowedBuildWarnings,
	mergeAllowedBuildWarnings,
	scanBuildWarningText,
} from '../src/operations/services/build-warning-policy.ts';

type ParsedArgs = {
	files: string[];
	allow: string[];
	useDefaultPolicy: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
	const files: string[] = [];
	const allow: string[] = [];
	let useDefaultPolicy = true;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--allow') {
			const pattern = argv[index + 1];
			if (!pattern) throw new Error('--allow requires a regular expression.');
			allow.push(pattern);
			index += 1;
			continue;
		}
		if (arg === '--no-default-policy') {
			useDefaultPolicy = false;
			continue;
		}
		files.push(arg);
	}
	return { files, allow, useDefaultPolicy };
}

const args = parseArgs(process.argv.slice(2));
if (args.files.length === 0) {
	throw new Error('Usage: tsx scripts/check-build-warnings.ts <log-file> [<log-file> ...] [--allow <regex>] [--no-default-policy]');
}

const allowedWarnings = new Map<string, number>();
const unexpectedWarnings: string[] = [];
for (const file of args.files) {
	const result = scanBuildWarningText(readFileSync(file, 'utf8'), {
		allow: args.allow,
		useDefaultPolicy: args.useDefaultPolicy,
	});
	mergeAllowedBuildWarnings(allowedWarnings, result.allowedWarnings);
	unexpectedWarnings.push(...result.unexpectedWarnings);
}

const allowedLines = formatAllowedBuildWarnings(allowedWarnings);
if (allowedLines.length > 0) {
	console.log(allowedLines.join('\n'));
}

if (unexpectedWarnings.length > 0) {
	console.error('Unexpected build warnings detected:');
	for (const warning of unexpectedWarnings) {
		console.error(`- ${warning}`);
	}
	process.exit(1);
}

console.log('No unexpected build warnings detected.');
