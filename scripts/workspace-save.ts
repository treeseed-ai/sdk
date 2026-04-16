#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { TreeseedWorkflowError, TreeseedWorkflowSdk, type TreeseedWorkflowResult } from '../src/workflow.ts';
import {
	formatWorkspaceSaveFailureReport,
	formatWorkspaceSaveSuccessReport,
	parseWorkspaceSaveScriptArgs,
} from '../src/operations/services/workspace-save-script.ts';

function writeSaveReport(payload: unknown) {
	const target = process.env.TREESEED_SAVE_REPORT_PATH;
	if (!target) {
		return;
	}

	const filePath = resolve(target);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function printSaveSummary(payload: Record<string, unknown>) {
	const commitSha = typeof payload.commitSha === 'string' ? payload.commitSha : '';
	const previewStatus = typeof (payload.previewAction as { status?: unknown } | undefined)?.status === 'string'
		? String((payload.previewAction as { status?: string }).status)
		: 'skipped';

	if (payload.noChanges === true) {
		console.log('Treeseed save found no new changes and confirmed branch sync.');
	} else {
		console.log('Treeseed save completed successfully.');
	}
	if (typeof payload.branch === 'string') {
		console.log(`Branch: ${payload.branch}`);
	}
	if (typeof payload.scope === 'string') {
		console.log(`Environment scope: ${payload.scope}`);
	}
	if (commitSha) {
		console.log(`Commit: ${commitSha.slice(0, 12)}`);
	}
	console.log(`Preview action: ${previewStatus}`);
}

async function main() {
	const options = parseWorkspaceSaveScriptArgs(process.argv.slice(2));
	const workflow = new TreeseedWorkflowSdk({
		cwd: process.cwd(),
		env: process.env,
	});

	try {
		const result = await workflow.save({
			message: options.message,
			hotfix: options.hotfix,
		});
		const payload = result.payload as Record<string, unknown>;
		writeSaveReport(formatWorkspaceSaveSuccessReport(result as TreeseedWorkflowResult<Record<string, unknown>>));
		printSaveSummary(payload);
	} catch (error) {
		if (error instanceof TreeseedWorkflowError) {
			writeSaveReport(formatWorkspaceSaveFailureReport(error));
			console.error(error.message);
			process.exit(error.exitCode ?? 1);
		}

		const report = formatWorkspaceSaveFailureReport(error);
		console.error(report.message);
		writeSaveReport(report);
		process.exit(1);
	}
}

await main();
