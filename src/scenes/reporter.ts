import { writeFileSync } from 'node:fs';
import type { TreeseedSceneRunReport } from './types.ts';
import { formatTreeseedSceneDiagnostics } from './diagnostics.ts';

function row(values: string[]) {
	return `| ${values.map((value) => value.replace(/\|/gu, '\\|')).join(' | ')} |`;
}

export function formatTreeseedSceneMarkdownReport(report: TreeseedSceneRunReport) {
	const lines = [
		`# Treeseed Scene Run: ${report.sceneId ?? '(unknown)'}`,
		'',
		`- Status: ${report.workflowStatus}`,
		`- Run: ${report.runId ?? '(none)'}`,
		`- Environment: ${report.environment}`,
		`- Base URL: ${report.baseUrl ?? '(unresolved)'}`,
		`- Browser: ${report.browser ?? '(unknown)'}`,
		`- Setup: ${report.setup ? setupSummary(report) : '(not run)'}`,
		`- Started: ${report.startedAt}`,
		`- Finished: ${report.finishedAt}`,
		`- Duration: ${report.durationMs}ms`,
		'',
		'## Steps',
		'',
		row(['Step', 'Title', 'Action', 'Status', 'Screenshot']),
		row(['---', '---', '---', '---', '---']),
		...report.steps.map((step) => row([
			step.id,
			step.title,
			step.actionKind,
			step.status,
			step.screenshotPath ?? '',
		])),
		'',
	];
	if (report.failedStep) {
		const failed = report.steps.find((step) => step.id === report.failedStep);
		lines.push('## Failed Step', '', `- Step: ${report.failedStep}`);
		if (failed?.error) lines.push(`- Error: ${failed.error.code}: ${failed.error.message}`);
		if (failed?.screenshotPath) lines.push(`- Screenshot: ${failed.screenshotPath}`);
		if (report.playwrightTracePath) lines.push(`- Trace: ${report.playwrightTracePath}`);
		lines.push('');
	}
	if (report.setup) {
		lines.push('## Setup', '');
		lines.push(`- Environment readiness: ${report.setup.environment?.ok ? 'passed' : 'failed'}`);
		lines.push(`- Local dev: ${report.setup.environment?.dev.requested ? report.setup.environment.dev.reused ? 'reused' : report.setup.environment.dev.started ? 'started' : 'requested' : 'not requested'}`);
		lines.push(`- Auth: ${report.setup.auth?.required ? report.setup.auth.hasSession ? 'resolved' : 'missing' : 'optional'}`);
		lines.push(`- Seed: ${report.setup.seed?.mode ?? 'none'}`);
		lines.push('');
	}
	if (report.operations.length > 0) {
		lines.push('## Operations', '');
		for (const operation of report.operations) {
			lines.push(`- ${operation.operationId ?? '(unresolved)'}: ${operation.finalStatus ?? '(unknown)'} (${operation.ok ? 'passed' : 'failed'})`);
		}
		lines.push('');
	}
	if (report.diagnostics.length > 0) {
		lines.push('## Diagnostics', '', ...formatTreeseedSceneDiagnostics(report.diagnostics).map((line) => `- ${line}`), '');
	}
	lines.push('## Artifacts', '');
	if (report.artifacts) {
		lines.push(
			`- Run JSON: ${report.artifacts.runPath}`,
			`- Timeline: ${report.artifacts.timelinePath}`,
			`- Trace: ${report.artifacts.playwrightTracePath ?? '(none)'}`,
			`- Console: ${report.artifacts.consoleLogPath ?? '(none)'}`,
			`- Network: ${report.artifacts.networkLogPath ?? '(none)'}`,
			`- Dev logs: ${report.logs.dev ?? '(none)'}`,
			`- API logs: ${report.logs.api ?? '(none)'}`,
			`- Operations runner logs: ${report.logs.operationsRunner ?? '(none)'}`,
		);
	} else {
		lines.push('- No artifacts were written.');
	}
	lines.push('', '## Console And Network Errors', '');
	const consoleErrors = report.steps.flatMap((step) => step.consoleErrors.map((entry) => `${step.id}: ${entry.message}`));
	const networkErrors = report.steps.flatMap((step) => step.networkErrors.map((entry) => `${step.id}: ${entry.method ?? 'GET'} ${entry.url ?? ''} ${entry.status ?? ''} ${entry.message}`.trim()));
	if (consoleErrors.length === 0 && networkErrors.length === 0) {
		lines.push('- None observed.');
	} else {
		lines.push(...consoleErrors.map((entry) => `- Console: ${entry}`), ...networkErrors.map((entry) => `- Network: ${entry}`));
	}
	return `${lines.join('\n')}\n`;
}

function setupSummary(report: TreeseedSceneRunReport) {
	const setup = report.setup;
	if (!setup) return 'not run';
	const parts = [];
	if (setup.environment?.dev.requested) parts.push(setup.environment.dev.reused ? 'dev reused' : setup.environment.dev.started ? 'dev started' : 'dev requested');
	if (setup.seed?.requested) parts.push(setup.seed.mode === 'apply' ? 'seed applied' : 'seed planned');
	if (setup.auth?.required) parts.push(setup.auth.hasSession ? 'auth resolved' : 'auth missing');
	return parts.length > 0 ? parts.join(', ') : 'checked';
}

export function writeTreeseedSceneMarkdownReport(report: TreeseedSceneRunReport) {
	if (!report.artifacts) return;
	writeFileSync(report.artifacts.markdownReportPath, formatTreeseedSceneMarkdownReport(report), 'utf8');
}
