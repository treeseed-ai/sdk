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
		planOnly: false,
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
		if (current === '--plan') {
			parsed.planOnly = true;
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
	if (options.action === 'publish_content') {
		const { reconcileContentPublication } = await import('../../src/platform/published-content/reconcile-content-publication.ts');
		const environment = options.environment ?? 'staging';
		const validateOnly = options.planOnly;
		const required = (value: string | undefined, name: string) => {
			if (!value?.trim()) throw new Error(`${name} is required.`);
			return value.trim();
		};
		const result = await reconcileContentPublication({
			projectRoot: tenantRoot,
			contentPath: process.env.TREESEED_CONTENT_PATH ?? 'src/content',
			teamId: required(process.env.TREESEED_TEAM_ID, 'TREESEED_TEAM_ID'),
			projectId: options.projectId ?? required(process.env.TREESEED_PROJECT_ID, 'TREESEED_PROJECT_ID'),
			sourceCommit: required(process.env.GITHUB_SHA ?? process.env.TREESEED_SOURCE_COMMIT, 'source commit'),
			ref: required(process.env.GITHUB_REF_NAME ?? process.env.TREESEED_SOURCE_REF, 'source ref'),
			channel: options.previewId ? 'preview' : environment === 'prod' || environment === 'production' ? 'production' : 'staging',
			validateOnly,
			...(!validateOnly ? { r2: {
				accountId: required(process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID, 'TREESEED_CLOUDFLARE_ACCOUNT_ID'),
				bucket: required(process.env.TREESEED_CONTENT_BUCKET_NAME, 'TREESEED_CONTENT_BUCKET_NAME'),
				accessKeyId: required(process.env.TREESEED_R2_ACCESS_KEY_ID, 'TREESEED_R2_ACCESS_KEY_ID'),
				secretAccessKey: required(process.env.TREESEED_R2_SECRET_ACCESS_KEY, 'TREESEED_R2_SECRET_ACCESS_KEY'),
			} } : {}),
		});
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		writeStatus('complete.');
		return;
	}
	writeStatus('loading project platform module...');
	const { resolveScope, runProjectPlatformAction } = await import('../../src/operations/services/projects/projects-core/project-platform.ts');
	writeStatus('project platform module loaded.');
	const scope = resolveScope(options.environment);
	writeStatus(`resolved scope=${scope}; running action...`);
	const result = await runProjectPlatformAction(options.action, {
		tenantRoot,
		scope,
		projectId: options.projectId ?? process.env.TREESEED_PROJECT_ID ?? null,
		previewId: options.previewId,
		planOnly: options.planOnly,
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
