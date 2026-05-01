#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
	resolveScope,
	runProjectPlatformAction,
	type ProjectPlatformAction,
} from '../src/operations/services/project-platform.ts';

const tenantRoot = process.cwd();

function parseArgs(argv: string[]) {
	const parsed = {
		action: 'deploy_code' as ProjectPlatformAction,
		environment: null as string | null,
		projectId: null as string | null,
		previewId: null as string | null,
		dryRun: false,
		skipProvision: false,
	};

	const rest = [...argv];
	while (rest.length) {
		const current = rest.shift();
		if (!current) continue;
		if (current === '--action') {
			parsed.action = (rest.shift() ?? parsed.action) as ProjectPlatformAction;
			continue;
		}
		if (current.startsWith('--action=')) {
			parsed.action = (current.split('=', 2)[1] ?? parsed.action) as ProjectPlatformAction;
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
		if (current === '--project-id') {
			parsed.projectId = rest.shift() ?? null;
			continue;
		}
		if (current.startsWith('--project-id=')) {
			parsed.projectId = current.split('=', 2)[1] ?? null;
			continue;
		}
		if (current === '--preview-id') {
			parsed.previewId = rest.shift() ?? null;
			continue;
		}
		if (current.startsWith('--preview-id=')) {
			parsed.previewId = current.split('=', 2)[1] ?? null;
			continue;
		}
		if (current === '--dry-run') {
			parsed.dryRun = true;
			continue;
		}
		if (current === '--skip-provision') {
			parsed.skipProvision = true;
			continue;
		}
		throw new Error(`Unknown workflow action argument: ${current}`);
	}

	return parsed;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const scope = resolveScope(options.environment);
	const result = await runProjectPlatformAction(options.action, {
		tenantRoot,
		scope,
		projectId: options.projectId ?? process.env.TREESEED_PROJECT_ID ?? null,
		previewId: options.previewId,
		dryRun: options.dryRun,
		skipProvision: options.skipProvision,
	});

	if (result !== undefined) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	}
}

function isCliEntrypoint() {
	if (!process.argv[1]) {
		return false;
	}
	if (import.meta.url === pathToFileURL(process.argv[1]).href) {
		return true;
	}
	return /(?:^|\/)tenant-workflow-action\.(?:ts|js)$/u.test(process.argv[1]);
}

if (isCliEntrypoint()) {
	await main();
}

export { isCliEntrypoint, parseArgs };
