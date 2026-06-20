import { mkdirSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import type {
	TreeseedSceneVisualAuditCapture,
	TreeseedSceneVisualAuditManifest,
	TreeseedSceneVisualAuditPaths,
	TreeseedSceneVisualAuditReview,
} from './types.ts';

function md(value: unknown) {
	return String(value ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ');
}

function rel(root: string, path: string | null) {
	return path ? relative(root, path) : '';
}

function firstDiagnostic(capture: TreeseedSceneVisualAuditCapture) {
	return capture.diagnostics[0] ?? null;
}

export function formatTreeseedSceneVisualAuditMarkdown(input: {
	manifest: TreeseedSceneVisualAuditManifest;
	paths: TreeseedSceneVisualAuditPaths;
	review?: TreeseedSceneVisualAuditReview | null;
}) {
	const { manifest, paths } = input;
	const failed = manifest.captures.filter((capture) => capture.status === 'failed');
	const skipped = manifest.captures.filter((capture) => capture.status === 'skipped');
	const captured = manifest.captures.filter((capture) => capture.status === 'captured');
	const roots = [...new Set(manifest.routes.map((route) => route.pathRoot))].sort();
	const lines = [
		'# TreeSeed Scene Visual Audit',
		'',
		`Scene: ${manifest.sceneId ?? '(unknown)'}`,
		`Audit: ${manifest.auditId}`,
		`Base URL: ${manifest.baseUrl ?? '(unresolved)'}`,
		`Generated: ${manifest.generatedAt}`,
		'',
		'## Summary',
		'',
		`- Roles: ${manifest.roles.join(', ') || '(none)'}`,
		`- Devices: ${manifest.devices.join(', ') || '(none)'}`,
		`- Routes: ${manifest.routes.length}`,
		`- Captures: ${captured.length}`,
		`- Failed: ${failed.length}`,
		`- Skipped: ${skipped.length}`,
		`- Review findings: ${input.review?.summary.findingCount ?? 0}`,
		`- Root causes: ${input.review?.summary.rootCauseCount ?? 0}`,
		`- Incidents: ${input.review?.summary.incidentCount ?? 0}`,
		`- Raw client errors: ${input.review?.summary.clientErrorCount ?? 0}`,
		'',
	];
	if (input.review && paths.reviewRoot) {
		lines.push('## Review', '');
		lines.push(`- Agent brief: [review/agent-brief.md](${md(rel(paths.auditRoot, paths.reviewAgentBriefPath))})`);
		lines.push(`- Issue index: [review/issue-index.json](${md(rel(paths.auditRoot, `${paths.reviewRoot}/issue-index.json`))})`);
		lines.push(`- Top priority: [review/query/top-priority.json](${md(rel(paths.auditRoot, `${paths.reviewRoot}/query/top-priority.json`))})`);
		lines.push(`- Root causes: [review/root-causes.json](${md(rel(paths.auditRoot, `${paths.reviewRoot}/root-causes.json`))})`);
		lines.push(`- Incidents: [review/incidents.json](${md(rel(paths.auditRoot, `${paths.reviewRoot}/incidents.json`))})`);
		lines.push(`- Findings JSON: [review/findings.json](${md(rel(paths.auditRoot, paths.reviewFindingsPath))})`);
		lines.push(`- Contact sheets: [review/contact-sheets/index.html](${md(rel(paths.auditRoot, `${paths.reviewRoot}/contact-sheets/index.html`))})`);
		lines.push(`- Flagged contact sheet: [review/contact-sheets/flagged.html](${md(rel(paths.auditRoot, `${paths.reviewRoot}/contact-sheets/flagged.html`))})`);
		lines.push(`- Root-cause contact sheet: [review/contact-sheets/root-causes.html](${md(rel(paths.auditRoot, `${paths.reviewRoot}/contact-sheets/root-causes.html`))})`);
		lines.push('');
	}
	lines.push('## By Path Root', '');
	for (const root of roots) {
		lines.push(`### ${root}`, '');
		lines.push('| Role | Device | Path | Status | Screenshot |');
		lines.push('| --- | --- | --- | --- | --- |');
		const captures = manifest.captures.filter((capture) => capture.pathRoot === root)
			.sort((a, b) => `${a.role}:${a.device}:${a.path}`.localeCompare(`${b.role}:${b.device}:${b.path}`));
		for (const capture of captures) {
			const screenshot = capture.screenshotPath ? `[view](${md(rel(paths.auditRoot, capture.screenshotPath))})` : '';
			lines.push(`| ${md(capture.role)} | ${md(capture.device)} | ${md(capture.path)} | ${md(capture.status)} | ${screenshot} |`);
		}
		lines.push('');
	}
	lines.push('## Failures', '');
	lines.push('| Role | Device | Path | Code | Message |');
	lines.push('| --- | --- | --- | --- | --- |');
	for (const capture of [...failed, ...skipped]) {
		const diagnostic = firstDiagnostic(capture);
		lines.push(`| ${md(capture.role)} | ${md(capture.device)} | ${md(capture.path)} | ${md(diagnostic?.code ?? capture.status)} | ${md(diagnostic?.message ?? capture.status)} |`);
	}
	lines.push('');
	return `${lines.join('\n')}\n`;
}

export function writeTreeseedSceneVisualAuditReport(input: {
	manifest: TreeseedSceneVisualAuditManifest;
	paths: TreeseedSceneVisualAuditPaths;
	review?: TreeseedSceneVisualAuditReview | null;
}) {
	mkdirSync(input.paths.auditRoot, { recursive: true });
	writeFileSync(input.paths.manifestPath, `${JSON.stringify(input.manifest, null, 2)}\n`, 'utf8');
	writeFileSync(input.paths.reportPath, formatTreeseedSceneVisualAuditMarkdown(input), 'utf8');
}
