#!/usr/bin/env node

import { resolve } from 'node:path';
import { reconcileContentPublication,type ContentPublicationChannel } from '../../src/platform/published-content/reconcile-content-publication.ts';
import { runR2PublicationAcceptance } from '../../src/platform/published-content/r2-publication-acceptance.ts';

function args(values: string[]) {
	const result: Record<string, string | boolean> = {};
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index]!;
		if (!value.startsWith('--')) throw new Error(`Unexpected argument: ${value}`);
		const [name, inline] = value.slice(2).split('=', 2);
		if (inline !== undefined) result[name!] = inline;
		else if (values[index + 1] && !values[index + 1]!.startsWith('--')) result[name!] = values[++index]!;
		else result[name!] = true;
	}
	return result;
}

function required(value: string | boolean | undefined, label: string) {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
	return value.trim();
}

function channel(value: string): ContentPublicationChannel {
	if (value === 'preview' || value === 'staging' || value === 'production') return value;
	throw new Error('channel must be preview, staging, or production.');
}

async function main() {
	const input = args(process.argv.slice(2));
	const validateOnly = input['validate-only'] === true;
	const accountId = !validateOnly ? required(process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID, 'TREESEED_CLOUDFLARE_ACCOUNT_ID') : null;
	const bucket = !validateOnly ? required(process.env.TREESEED_CONTENT_BUCKET_NAME, 'TREESEED_CONTENT_BUCKET_NAME') : null;
	const r2 = validateOnly ? undefined
		: process.env.TREESEED_R2_ACCESS_KEY_ID && process.env.TREESEED_R2_SECRET_ACCESS_KEY
			? { accountId: accountId!, bucket: bucket!, accessKeyId: process.env.TREESEED_R2_ACCESS_KEY_ID, secretAccessKey: process.env.TREESEED_R2_SECRET_ACCESS_KEY }
			: { authMode: 'api-token' as const, accountId: accountId!, bucket: bucket!, apiToken: required(process.env.TREESEED_CLOUDFLARE_API_TOKEN, 'TREESEED_CLOUDFLARE_API_TOKEN or R2 access-key pair') };
	if (input.acceptance === true) {
		if (!r2) throw new Error('R2 credentials are required for acceptance.');
		process.stdout.write(`${JSON.stringify(await runR2PublicationAcceptance({ teamId: required(input['team-id'] ?? process.env.TREESEED_TEAM_ID, 'team-id'), r2 }), null, 2)}\n`);
		return;
	}
	const receipt = await reconcileContentPublication({
		projectRoot: resolve(String(input.root ?? process.cwd())),
		contentPath: required(input['content-path'], 'content-path'),
		teamId: required(input['team-id'] ?? process.env.TREESEED_TEAM_ID, 'team-id'),
		projectId: required(input['project-id'] ?? process.env.TREESEED_PROJECT_ID, 'project-id'),
		sourceCommit: required(input['source-commit'] ?? process.env.GITHUB_SHA, 'source-commit'),
		ref: required(input.ref ?? process.env.GITHUB_REF_NAME, 'ref'),
		channel: channel(required(input.channel, 'channel')),
		validateOnly,
		...(r2 ? { r2 } : {}),
	});
	process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

try {
	await main();
} catch (error) {
	const value = error as { code?: unknown; details?: unknown; message?: unknown };
	process.stderr.write(`${JSON.stringify({
		ok: false,
		code: typeof value?.code === 'string' ? value.code : 'content_publication_failed',
		error: typeof value?.message === 'string' ? value.message : String(error),
		...(Array.isArray(value?.details) ? { details: value.details } : {}),
	}, null, 2)}\n`);
	process.exitCode = 1;
}
