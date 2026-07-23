import { mkdirSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import type {
	TreeseedSceneDiagnostic,
	TreeseedSceneVisualAuditCapture,
	TreeseedSceneVisualAuditClientError,
	TreeseedSceneVisualAuditClientErrorIncident,
	TreeseedSceneVisualAuditFinding,
	TreeseedSceneVisualAuditFindingOwner,
	TreeseedSceneVisualAuditFindingSeverity,
	TreeseedSceneVisualAuditManifest,
	TreeseedSceneVisualAuditPaths,
	TreeseedSceneVisualAuditReview,
	TreeseedSceneVisualAuditReviewCategory,
	TreeseedSceneVisualAuditReviewDetail,
	TreeseedSceneVisualAuditRole,
	TreeseedSceneVisualAuditRootCause,
} from '../types.ts';
import { writeTreeseedSceneVisualAuditContactSheets } from '../visual-audit-contact-sheets.ts';
import { CATEGORIES, EnrichedClientError, OWNERS, SEVERITIES, captureFindings, countMap, isTreeseedSceneVisualAuditIgnoredClientError, md, priorityBand, priorityScore, recommendedAction, rel } from './severities.ts';
import { architectureFindings, buildClientErrorIncidents, buildRootCauses, expectedFindingNoise, filteredFindings, incidentFindings } from './incident-title.ts';

export function enrichClientErrors(captures: TreeseedSceneVisualAuditCapture[]): EnrichedClientError[] {
	return captures.flatMap((capture) => (capture.clientErrors ?? [])
		.filter((entry) => !isTreeseedSceneVisualAuditIgnoredClientError(entry))
		.map((entry) => ({
			...entry,
			path: capture.path,
			pathRoot: capture.pathRoot,
			role: capture.role,
			device: capture.device,
			screenshotPath: capture.screenshotPath,
			finalUrl: capture.finalUrl,
		} satisfies TreeseedSceneVisualAuditClientError)));
}

export function buildTreeseedSceneVisualAuditReview(input: {
	manifest: TreeseedSceneVisualAuditManifest;
	paths: TreeseedSceneVisualAuditPaths;
	detail?: TreeseedSceneVisualAuditReviewDetail;
	maxFindings?: number;
}): TreeseedSceneVisualAuditReview {
	const detail = input.detail ?? 'standard';
	const allFindings: TreeseedSceneVisualAuditFinding[] = [];
	const routesById = new Map(input.manifest.routes.map((route) => [route.id, route]));
	for (const capture of input.manifest.captures) allFindings.push(...captureFindings(capture, allFindings.length, routesById.get(capture.routeId)));
	const clientErrors = enrichClientErrors(input.manifest.captures);
	const incidents = buildClientErrorIncidents(clientErrors);
	allFindings.push(...incidentFindings(incidents, input.manifest.captures, allFindings.length));
	allFindings.push(...architectureFindings(input.manifest.captures, allFindings, allFindings.length));
	const findings = filteredFindings(allFindings, detail, input.maxFindings ?? 250);
	const rootCauses = buildRootCauses(allFindings.filter((entry) => !expectedFindingNoise(entry)));
	const bySeverity = countMap(SEVERITIES);
	const byCategory = countMap(CATEGORIES);
	const byOwner = countMap(OWNERS);
	const byPriorityBand = { critical: 0, high: 0, medium: 0, low: 0 };
	const byPathRoot: Record<string, number> = {};
	for (const entry of allFindings) {
		bySeverity[entry.severity] += 1;
		byCategory[entry.category] += 1;
		byOwner[entry.suspectedOwner] += 1;
		byPathRoot[entry.pathRoot] = (byPathRoot[entry.pathRoot] ?? 0) + 1;
	}
	for (const entry of rootCauses) byPriorityBand[priorityBand(entry.priorityScore)] += 1;
	const generatedAt = new Date().toISOString();
	const diagnostics: TreeseedSceneDiagnostic[] = [];
	return {
		schemaVersion: 'treeseed.scene.visual-audit-review/v1',
		generatedAt,
		auditId: input.manifest.auditId,
		sceneId: input.manifest.sceneId,
		summary: {
			generatedAt,
			detail,
			routeCount: input.manifest.routes.length,
			captureCount: input.manifest.captures.length,
			findingCount: allFindings.length,
			rootCauseCount: rootCauses.length,
			incidentCount: incidents.length,
			clientErrorCount: clientErrors.length,
			highestPriorityScore: rootCauses[0]?.priorityScore ?? incidents[0]?.priorityScore ?? 0,
			byPriorityBand,
			bySeverity,
			byCategory,
			byOwner,
			byPathRoot,
		},
		findings,
		rootCauses,
		incidents,
		clientErrors,
		diagnostics,
	};
}

export function rootCauseTable(input: { paths: TreeseedSceneVisualAuditPaths; rootCauses: TreeseedSceneVisualAuditRootCause[] }) {
	const lines = [
		'| Rank | Score | Severity | Owner | Count | Root cause | Examples | Screenshot |',
		'| ---: | ---: | --- | --- | ---: | --- | --- | --- |',
	];
	for (const entry of input.rootCauses) {
		const screenshot = entry.exampleScreenshotPath ? `[view](${md(rel(input.paths.auditRoot, entry.exampleScreenshotPath))})` : '';
		lines.push(`| ${entry.priorityRank} | ${entry.priorityScore} | ${entry.severity} | ${md(entry.suspectedOwner)} | ${entry.count} | ${md(entry.title)} | ${md(entry.paths.slice(0, 4).join(', '))} | ${screenshot} |`);
	}
	return lines;
}

export function issueSummary(entry: TreeseedSceneVisualAuditRootCause | TreeseedSceneVisualAuditClientErrorIncident) {
	return {
		id: entry.id,
		priorityRank: entry.priorityRank,
		priorityScore: entry.priorityScore,
		severity: entry.severity,
		owner: entry.suspectedOwner,
		category: 'category' in entry ? entry.category : 'client-error',
		code: entry.code,
		title: entry.title,
		count: entry.count,
		pathRoots: entry.pathRoots,
		paths: entry.paths,
		roles: entry.roles,
		devices: entry.devices,
		exampleScreenshotPath: entry.exampleScreenshotPath,
		recommendedAction: entry.recommendedAction,
	};
}

export function combinedPriorityQueue(review: TreeseedSceneVisualAuditReview) {
	return [...review.rootCauses.map(issueSummary), ...review.incidents.map(issueSummary)]
		.sort((a, b) => b.priorityScore - a.priorityScore || a.priorityRank - b.priorityRank);
}

export function groupBy<T>(items: T[], key: (item: T) => string | string[]) {
	const groups: Record<string, T[]> = {};
	for (const item of items) {
		const keys = key(item);
		for (const entry of Array.isArray(keys) ? keys : [keys]) {
			groups[entry] = [...(groups[entry] ?? []), item];
		}
	}
	return groups;
}

export function jsonl<T>(items: T[]) {
	return items.map((entry) => JSON.stringify(entry)).join('\n') + (items.length ? '\n' : '');
}

export function formatTreeseedSceneVisualAuditFindingsMarkdown(input: {
	manifest: TreeseedSceneVisualAuditManifest;
	review: TreeseedSceneVisualAuditReview;
	paths: TreeseedSceneVisualAuditPaths;
}) {
	const lines = [
		'# TreeSeed Visual Audit Findings',
		'',
		`Scene: ${input.manifest.sceneId ?? '(unknown)'}`,
		`Audit: ${input.manifest.auditId}`,
		`Generated: ${input.review.generatedAt}`,
		'',
		'## Summary',
		'',
		`- Findings: ${input.review.summary.findingCount}`,
		`- Root causes: ${input.review.summary.rootCauseCount}`,
		`- Incidents: ${input.review.summary.incidentCount}`,
		`- Included findings: ${input.review.findings.length}`,
		`- Raw client errors: ${input.review.summary.clientErrorCount}`,
		'',
		'## Root Causes',
		'',
		...rootCauseTable({ paths: input.paths, rootCauses: input.review.rootCauses }),
		'',
		'## Findings',
		'',
		'| Severity | Category | Code | Owner | Role | Device | Path | Screenshot |',
		'| --- | --- | --- | --- | --- | --- | --- | --- |',
	];
	for (const entry of input.review.findings) {
		const screenshot = entry.screenshotPath ? `[view](${md(rel(input.paths.auditRoot, entry.screenshotPath))})` : '';
		lines.push(`| ${entry.severity} | ${entry.category} | ${md(entry.code)} | ${md(entry.suspectedOwner)} | ${md(entry.role)} | ${md(entry.device)} | ${md(entry.path)} | ${screenshot} |`);
		lines.push(`|  |  |  |  |  |  | ${md(entry.message)} ${md(entry.architectureGuidance)} |  |`);
	}
	lines.push('');
	return `${lines.join('\n')}\n`;
}

export function formatTreeseedSceneVisualAuditAgentBrief(input: {
	manifest: TreeseedSceneVisualAuditManifest;
	review: TreeseedSceneVisualAuditReview;
	paths: TreeseedSceneVisualAuditPaths;
}) {
	const high = input.review.findings.filter((entry) => entry.severity === 'blocking' || entry.severity === 'high');
	const client = input.review.findings.filter((entry) => entry.category === 'client-error' && !expectedFindingNoise(entry));
	const architecture = input.review.findings.filter((entry) => entry.category === 'architecture');
	const priorityQueue = combinedPriorityQueue(input.review).slice(0, 50);
	const lines = [
		'# Visual Audit Agent Brief',
		'',
		'## Mission',
		'',
		'Repair TreeSeed UI and functionality issues found by visual audit. Prefer reusable architecture fixes over route-local patches. Client-side browser/runtime errors are the first priority because the admin application is moving toward a progressively client-dominant architecture and reusable UI package foundation.',
		'',
		'## Priority Queue',
		'',
		'| Rank | Score | Severity | Owner | Count | Issue | Roots | Evidence |',
		'| ---: | ---: | --- | --- | ---: | --- | --- | --- |',
	];
	for (const entry of priorityQueue) {
		const screenshot = entry.exampleScreenshotPath ? rel(input.paths.auditRoot, entry.exampleScreenshotPath) : '';
		lines.push(`| ${entry.priorityRank} | ${entry.priorityScore} | ${entry.severity} | ${md(entry.owner)} | ${entry.count} | ${md(entry.title)} | ${md(entry.pathRoots.join(', '))} | ${screenshot ? `[view](${md(screenshot)})` : ''} |`);
	}
	lines.push(
		'',
		'## Raw Client Error Interpretation',
		'',
		'Raw client errors are preserved in `client-errors.jsonl`, but prioritized work should start from `incidents.json` and `root-causes.json` because browser console/resource events can duplicate the same route failure.',
		'',
		'## Root Causes To Assign First',
		'',
	);
	for (const entry of input.review.rootCauses.slice(0, 25)) {
		const screenshot = entry.exampleScreenshotPath ? rel(input.paths.auditRoot, entry.exampleScreenshotPath) : '(none)';
		lines.push(`- **#${entry.priorityRank} score ${entry.priorityScore} ${entry.severity} ${entry.suspectedOwner}** ${entry.title}`);
		lines.push(`  - Count: ${entry.count}; roots: ${entry.pathRoots.join(', ')}; roles: ${entry.roles.join(', ')}; devices: ${entry.devices.join(', ')}`);
		lines.push(`  - Example: ${entry.paths[0] ?? '(none)'}`);
		lines.push(`  - Screenshot: ${screenshot}`);
		lines.push(`  - Action: ${entry.recommendedAction}`);
	}
	lines.push(
		'',
		'## Critical Client-Side Errors',
		'',
	);
	if (client.length === 0) lines.push('No client-side errors were detected in the included findings.', '');
	for (const entry of client.slice(0, 50)) lines.push(`- **${entry.severity}** ${entry.path} ${entry.role}/${entry.device}: ${entry.message}`);
	lines.push('', '## Client Error Incidents', '');
	if (input.review.incidents.length === 0) lines.push('No client-error incidents were detected.', '');
	for (const entry of input.review.incidents.slice(0, 50)) lines.push(`- **#${entry.priorityRank} score ${entry.priorityScore} ${entry.severity} ${entry.suspectedOwner}** ${entry.title}: ${entry.count} raw event(s), roots ${entry.pathRoots.join(', ')}`);
	lines.push('', '## Highest Priority Findings', '');
	for (const entry of high.filter((entry) => !expectedFindingNoise(entry)).slice(0, 75)) lines.push(`- **${entry.severity} ${entry.code}** ${entry.path} ${entry.role}/${entry.device} (${entry.suspectedOwner}): ${entry.message}`);
	lines.push(
		'',
		'## Architecture Guidance',
		'',
		'- Fix shared controls/styles in `@treeseed/ui` when repeated across routes.',
		'- Fix admin composition, client initialization, state, auth, and access in `@treeseed/admin`.',
		'- Fix public/book style loading in `@treeseed/core`.',
		'- Fix tenant branding only in `@treeseed/market`.',
		'- Fix API/database fixture/access issues in `@treeseed/api`.',
		'- Do not add divergent one-off CSS unless the route is genuinely unique.',
		'',
		'## Architecture Findings',
		'',
	);
	if (architecture.length === 0) lines.push('No aggregate architecture findings were generated.', '');
	for (const entry of architecture) lines.push(`- **${entry.code}** (${entry.suspectedOwner}): ${entry.message}`);
	lines.push(
		'',
		'## Suggested Work Batches',
		'',
		'### Batch 1: Client Runtime Errors',
		'Fix console, page, request, hydration, and visible runtime errors before visual polish.',
		'',
		'### Batch 2: Shared UI Control Regressions',
		'Resolve repeated default link/button/form/control issues in `@treeseed/ui`.',
		'',
		'### Batch 3: Admin Access And Seeded Data Visibility',
		'Verify app shell routing, team/project membership, and seeded visual-audit entities.',
		'',
		'### Batch 4: Responsive And Mobile Issues',
		'Fix overflow, desktop layout leakage, and cramped mobile/tablet surfaces.',
		'',
		'### Batch 5: Public, Book, And Market Polish',
		'Restore public shell, book page, and tenant branding consistency.',
		'',
		'## Findings',
		'',
	);
	for (const entry of input.review.findings) {
		const screenshot = entry.screenshotPath ? rel(input.paths.auditRoot, entry.screenshotPath) : '(none)';
		lines.push(`- **${entry.severity} ${entry.code}** ${entry.path} ${entry.role}/${entry.device} -> ${entry.suspectedOwner}`);
		lines.push(`  - ${entry.message}`);
		lines.push(`  - Screenshot: ${screenshot}`);
		lines.push(`  - Guidance: ${entry.architectureGuidance}`);
	}
	lines.push('');
	return `${lines.join('\n')}\n`;
}
