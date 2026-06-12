#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const tenantRoot = process.cwd();
type ProjectPlatformAction = 'deploy_web' | 'publish_content' | 'monitor';

function writeStatus(message: string) {
	process.stderr.write(`[tenant-workflow-action] ${message}\n`);
}

function parseArgs(argv: string[]) {
	const parsed = {
		action: 'deploy_web' as ProjectPlatformAction,
		environment: null as string | null,
		projectId: null as string | null,
		previewId: null as string | null,
		dryRun: false,
	};

	const rest = [...argv];
	while (rest.length) {
		const current = rest.shift();
		if (!current) continue;
		if (current === '--action') {
			parsed.action = parseAction(rest.shift() ?? parsed.action);
			continue;
		}
		if (current.startsWith('--action=')) {
			parsed.action = parseAction(current.split('=', 2)[1] ?? parsed.action);
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
		throw new Error(`Unknown workflow action argument: ${current}`);
	}

	return parsed;
}

function parseAction(value: string): ProjectPlatformAction {
	if (value === 'deploy_web' || value === 'publish_content' || value === 'monitor') {
		return value;
	}
	throw new Error(`Unsupported workflow action "${value}". Expected deploy_web, publish_content, or monitor.`);
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	process.env.TREESEED_WORKFLOW_ACTION = options.action;
	process.env.TREESEED_WORKFLOW_PLANE ||= 'web';
	writeStatus(`start action=${options.action} environment=${options.environment ?? '(auto)'}`);
	writeStatus('loading project platform module...');
	const { resolveScope, runProjectPlatformAction } = await import('../src/operations/services/project-platform.ts');
	writeStatus('project platform module loaded.');
	const scope = resolveScope(options.environment);
	writeStatus(`resolved scope=${scope}; running action...`);
	const result = await runProjectPlatformAction(options.action, {
		tenantRoot,
		scope,
		projectId: options.projectId ?? process.env.TREESEED_PROJECT_ID ?? null,
		previewId: options.previewId,
		dryRun: options.dryRun,
		write: (line) => writeStatus(line),
	});

	if (result !== undefined) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	}
	writeStatus('complete.');
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
