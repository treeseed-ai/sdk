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
import { combinedPriorityQueue, formatTreeseedSceneVisualAuditAgentBrief, formatTreeseedSceneVisualAuditFindingsMarkdown, groupBy, issueSummary, jsonl } from './enrich-client-errors.ts';
import { expectedFindingNoise } from './incident-title.ts';
import { OWNERS, finding, guidance, md, priorityBand, priorityScore, recommendedAction, rel } from './severities.ts';

export function formatOwnerBrief(input: {
	owner: TreeseedSceneVisualAuditFindingOwner;
	manifest: TreeseedSceneVisualAuditManifest;
	review: TreeseedSceneVisualAuditReview;
	paths: TreeseedSceneVisualAuditPaths;
}) {
	const rootCauses = input.review.rootCauses.filter((entry) => entry.suspectedOwner === input.owner);
	const incidents = input.review.incidents.filter((entry) => entry.suspectedOwner === input.owner);
	const priorityQueue = combinedPriorityQueue(input.review).filter((entry) => entry.owner === input.owner).slice(0, 50);
	const findings = input.review.findings.filter((entry) => entry.suspectedOwner === input.owner && !expectedFindingNoise(entry));
	const lines = [
		`# Visual Audit Brief: ${input.owner}`,
		'',
		`Scene: ${input.manifest.sceneId ?? '(unknown)'}`,
		`Audit: ${input.manifest.auditId}`,
		'',
		'## Package Boundary',
		'',
		guidance(input.owner, 'visual.audit'),
		'',
		'## Priority Queue',
		'',
		'| Rank | Score | Severity | Count | Issue | Roots | Evidence |',
		'| ---: | ---: | --- | ---: | --- | --- | --- |',
	];
	for (const entry of priorityQueue) {
		const screenshot = entry.exampleScreenshotPath ? rel(input.paths.auditRoot, entry.exampleScreenshotPath) : '';
		lines.push(`| ${entry.priorityRank} | ${entry.priorityScore} | ${entry.severity} | ${entry.count} | ${md(entry.title)} | ${md(entry.pathRoots.join(', '))} | ${screenshot ? `[view](${md(screenshot)})` : ''} |`);
	}
	if (priorityQueue.length === 0) lines.push('|  |  |  |  | No prioritized issues were assigned to this owner. |  |  |');
	lines.push(
		'',
		'## Root Causes',
		'',
	);
	if (rootCauses.length === 0) lines.push('No root causes were assigned to this owner.', '');
	for (const entry of rootCauses) {
		const screenshot = entry.exampleScreenshotPath ? rel(input.paths.auditRoot, entry.exampleScreenshotPath) : '(none)';
		lines.push(`- **#${entry.priorityRank} score ${entry.priorityScore} ${entry.severity}** ${entry.title}`);
		lines.push(`  - Count: ${entry.count}`);
		lines.push(`  - Path roots: ${entry.pathRoots.join(', ')}`);
		lines.push(`  - Roles/devices: ${entry.roles.join(', ')} / ${entry.devices.join(', ')}`);
		lines.push(`  - Example screenshot: ${screenshot}`);
		lines.push(`  - Recommended action: ${entry.recommendedAction}`);
	}
	lines.push('', '## Client Error Incidents', '');
	if (incidents.length === 0) lines.push('No client-error incidents were assigned to this owner.', '');
	for (const entry of incidents.slice(0, 80)) {
		const screenshot = entry.exampleScreenshotPath ? rel(input.paths.auditRoot, entry.exampleScreenshotPath) : '(none)';
		lines.push(`- **#${entry.priorityRank} score ${entry.priorityScore} ${entry.severity} ${entry.code}** ${entry.title}`);
		lines.push(`  - Count: ${entry.count}`);
		lines.push(`  - Path roots: ${entry.pathRoots.join(', ')}`);
		lines.push(`  - Example screenshot: ${screenshot}`);
		lines.push(`  - Recommended action: ${entry.recommendedAction}`);
	}
	lines.push('', '## Representative Findings', '');
	for (const entry of findings.slice(0, 80)) {
		const screenshot = entry.screenshotPath ? rel(input.paths.auditRoot, entry.screenshotPath) : '(none)';
		lines.push(`- **${entry.severity} ${entry.code}** ${entry.path} ${entry.role}/${entry.device}`);
		lines.push(`  - ${entry.message}`);
		lines.push(`  - Screenshot: ${screenshot}`);
	}
	lines.push('');
	return `${lines.join('\n')}\n`;
}

export function writeTreeseedSceneVisualAuditReview(input: {
	manifest: TreeseedSceneVisualAuditManifest;
	review: TreeseedSceneVisualAuditReview;
	paths: TreeseedSceneVisualAuditPaths;
}) {
	if (!input.paths.reviewRoot || !input.paths.reviewSummaryPath || !input.paths.reviewFindingsPath || !input.paths.reviewAgentBriefPath) return;
	mkdirSync(input.paths.reviewRoot, { recursive: true });
	const priorityQueue = combinedPriorityQueue(input.review);
	const issueIndex = {
		schemaVersion: 'treeseed.scene.visual-audit-issue-index/v1',
		generatedAt: input.review.generatedAt,
		auditId: input.manifest.auditId,
		rootCauses: input.review.rootCauses.map(issueSummary),
		files: {
			rootCauses: 'root-causes.json',
			incidents: 'incidents.json',
			findings: 'findings.json',
			clientErrors: 'client-errors.jsonl',
			contactSheets: 'contact-sheets/index.html',
			flaggedContactSheet: 'contact-sheets/flagged.html',
			rootCauseContactSheet: 'contact-sheets/root-causes.html',
		},
	};
	writeFileSync(input.paths.reviewSummaryPath, `${JSON.stringify(input.review.summary, null, 2)}\n`, 'utf8');
	writeFileSync(input.paths.reviewFindingsPath, `${JSON.stringify(input.review.findings, null, 2)}\n`, 'utf8');
	writeFileSync(`${input.paths.reviewRoot}/findings.jsonl`, jsonl(input.review.findings), 'utf8');
	writeFileSync(`${input.paths.reviewRoot}/root-causes.json`, `${JSON.stringify(input.review.rootCauses, null, 2)}\n`, 'utf8');
	writeFileSync(`${input.paths.reviewRoot}/root-causes.jsonl`, jsonl(input.review.rootCauses), 'utf8');
	writeFileSync(`${input.paths.reviewRoot}/incidents.json`, `${JSON.stringify(input.review.incidents, null, 2)}\n`, 'utf8');
	writeFileSync(`${input.paths.reviewRoot}/incidents.jsonl`, jsonl(input.review.incidents), 'utf8');
	writeFileSync(`${input.paths.reviewRoot}/issue-index.json`, `${JSON.stringify(issueIndex, null, 2)}\n`, 'utf8');
	writeFileSync(input.paths.reviewAgentBriefPath, formatTreeseedSceneVisualAuditAgentBrief(input), 'utf8');
	writeFileSync(`${input.paths.reviewRoot}/findings.md`, formatTreeseedSceneVisualAuditFindingsMarkdown(input), 'utf8');
	writeFileSync(`${input.paths.reviewRoot}/client-errors.jsonl`, input.review.clientErrors.map((entry) => JSON.stringify(entry)).join('\n') + (input.review.clientErrors.length ? '\n' : ''), 'utf8');
	const queryRoot = `${input.paths.reviewRoot}/query`;
	mkdirSync(queryRoot, { recursive: true });
	writeFileSync(`${queryRoot}/top-priority.json`, `${JSON.stringify(priorityQueue.slice(0, 50), null, 2)}\n`, 'utf8');
	writeFileSync(`${queryRoot}/by-owner.json`, `${JSON.stringify(groupBy(priorityQueue, (entry) => entry.owner), null, 2)}\n`, 'utf8');
	writeFileSync(`${queryRoot}/by-path-root.json`, `${JSON.stringify(groupBy(priorityQueue, (entry) => entry.pathRoots), null, 2)}\n`, 'utf8');
	writeFileSync(`${queryRoot}/by-route.json`, `${JSON.stringify(groupBy(priorityQueue, (entry) => entry.paths), null, 2)}\n`, 'utf8');
	writeFileSync(`${queryRoot}/by-role.json`, `${JSON.stringify(groupBy(priorityQueue, (entry) => entry.roles), null, 2)}\n`, 'utf8');
	writeFileSync(`${queryRoot}/by-device.json`, `${JSON.stringify(groupBy(priorityQueue, (entry) => entry.devices), null, 2)}\n`, 'utf8');
	writeFileSync(`${queryRoot}/by-code.json`, `${JSON.stringify(groupBy(priorityQueue, (entry) => entry.code), null, 2)}\n`, 'utf8');
	writeFileSync(`${queryRoot}/by-priority.json`, `${JSON.stringify(groupBy(priorityQueue, (entry) => priorityBand(entry.priorityScore)), null, 2)}\n`, 'utf8');
	const ownerRoot = `${input.paths.reviewRoot}/owner-briefs`;
	mkdirSync(ownerRoot, { recursive: true });
	for (const owner of OWNERS) {
		const filename = owner.replace(/^@/u, '').replace(/[^a-z0-9-]+/giu, '-').toLowerCase();
		writeFileSync(`${ownerRoot}/${filename}.md`, formatOwnerBrief({ ...input, owner }), 'utf8');
	}
	writeFileSync(`${input.paths.reviewRoot}/routes.json`, `${JSON.stringify(input.manifest.routes.map((route) => ({
		id: route.id,
		path: route.path,
		pathRoot: route.pathRoot,
		roles: route.roles,
		source: route.source,
		findings: input.review.findings.filter((finding) => finding.path === route.path).length,
	})), null, 2)}\n`, 'utf8');
	writeTreeseedSceneVisualAuditContactSheets(input);
}
