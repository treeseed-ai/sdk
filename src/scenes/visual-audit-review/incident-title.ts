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
import { EnrichedClientError, SEVERITIES, errorIncidentCode, finding, guidance, normalizedErrorMessage, pathOwner, priorityScore, recommendedAction } from './severities.ts';

export function incidentTitle(code: string) {
	if (code === 'visual.client.http_500') return 'Routes return HTTP 500';
	if (code === 'visual.client.http_404') return 'Routes reference missing HTTP 404 resources';
	if (code === 'visual.client.request_aborted') return 'Requests abort during navigation';
	if (code === 'visual.client.runtime_error') return 'Client runtime errors occur';
	if (code === 'visual.client.page_error') return 'Uncaught page errors occur';
	return 'Client-side errors occur';
}

export function incidentSeverity(error: TreeseedSceneVisualAuditClientError): TreeseedSceneVisualAuditFindingSeverity {
	if (error.kind === 'pageerror' || error.kind === 'uncaught-exception') return 'blocking';
	if ((error.status ?? 0) >= 500 || normalizedErrorMessage(error) === 'http-500') return 'high';
	if ((error.status ?? 0) >= 400 || normalizedErrorMessage(error) === 'http-404') return 'medium';
	if (normalizedErrorMessage(error) === 'request-aborted') return 'medium';
	return error.severity === 'error' ? 'high' : 'medium';
}

export function incidentKey(error: EnrichedClientError) {
	return [
		errorIncidentCode(error),
		pathOwner(error.path),
		error.pathRoot,
		normalizedErrorMessage(error),
	].join('|');
}

export function buildClientErrorIncidents(errors: EnrichedClientError[]): TreeseedSceneVisualAuditClientErrorIncident[] {
	const grouped = new Map<string, EnrichedClientError[]>();
	for (const error of errors) {
		if (normalizedErrorMessage(error) === 'request-aborted' && error.finalUrl) continue;
		const list = grouped.get(incidentKey(error)) ?? [];
		list.push(error);
		grouped.set(incidentKey(error), list);
	}
	const output: TreeseedSceneVisualAuditClientErrorIncident[] = [];
	let index = 0;
	for (const list of grouped.values()) {
		const first = list[0];
		if (!first) continue;
		const code = errorIncidentCode(first);
		const owner = pathOwner(first.path);
		const paths = compactList(list.map((entry) => entry.path));
		const pathRoots = compactList(list.map((entry) => entry.pathRoot));
		const roles = compactList(list.map((entry) => entry.role));
		const devices = compactList(list.map((entry) => entry.device));
		const captureIds = compactList(list.map((entry) => entry.captureId));
		const severity = list.reduce<TreeseedSceneVisualAuditFindingSeverity>((best, entry) => severityRank(incidentSeverity(entry)) < severityRank(best) ? incidentSeverity(entry) : best, incidentSeverity(first));
		const score = priorityScore({
			severity,
			category: 'client-error',
			owner,
			count: list.length,
			pathCount: paths.length,
			roleCount: roles.length,
			deviceCount: devices.length,
			code,
		});
		output.push({
			id: `incident-${String(index += 1).padStart(3, '0')}`,
			severity,
			primaryKind: first.kind,
			code,
			title: incidentTitle(code),
			message: `${first.message} Seen ${list.length} raw event(s) across ${paths.length} path(s), ${roles.length} role(s), and ${devices.length} device profile(s).`,
			normalizedMessage: normalizedErrorMessage(first),
			suspectedOwner: owner,
			count: list.length,
			pathRoots,
			paths,
			roles,
			devices,
			captureIds,
			errorIds: list.map((entry) => entry.id),
			exampleScreenshotPath: list.find((entry) => entry.screenshotPath)?.screenshotPath ?? null,
			exampleFinalUrl: first.finalUrl,
			status: first.status ?? null,
			url: first.url,
			priorityScore: score,
			priorityRank: 0,
			recommendedAction: recommendedAction(owner, code),
			architectureGuidance: guidance(owner, code),
		});
	}
	return output.sort((a, b) => b.priorityScore - a.priorityScore || severityRank(a.severity) - severityRank(b.severity) || b.count - a.count)
		.map((entry, priorityRank) => ({ ...entry, priorityRank: priorityRank + 1 }));
}

export function incidentFindings(incidents: TreeseedSceneVisualAuditClientErrorIncident[], captures: TreeseedSceneVisualAuditCapture[], indexStart: number) {
	const byId = new Map(captures.map((capture) => [capture.id, capture]));
	const output: TreeseedSceneVisualAuditFinding[] = [];
	let index = indexStart;
	for (const incident of incidents) {
		const capture = incident.captureIds.map((id) => byId.get(id)).find(Boolean);
		if (!capture) continue;
		output.push(finding({
			index: index += 1,
			capture,
			severity: incident.severity,
			category: 'client-error',
			code: incident.code,
			title: incident.title,
			message: incident.message,
			owner: incident.suspectedOwner,
			evidence: { incidentId: incident.id, rawErrorCount: incident.count, errorIds: incident.errorIds.slice(0, 20) },
		}));
	}
	return output;
}

export function architectureFindings(captures: TreeseedSceneVisualAuditCapture[], findings: TreeseedSceneVisualAuditFinding[], indexStart: number) {
	const output: TreeseedSceneVisualAuditFinding[] = [];
	let index = indexStart;
	const sample = captures.find((capture) => capture.path.startsWith('/app')) ?? captures[0];
	if (!sample) return output;
	const repeated = (code: string) => findings.filter((entry) => entry.code === code);
	const push = (code: string, title: string, message: string, owner: TreeseedSceneVisualAuditFindingOwner, evidence: Record<string, unknown>) => {
		output.push(finding({ index: index += 1, capture: sample, severity: 'high', category: 'architecture', code, title, message, owner, evidence }));
	};
	if (new Set(repeated('visual.display.default_link_style').map((entry) => entry.path)).size >= 2 || new Set(repeated('visual.display.default_button_style').map((entry) => entry.path)).size >= 2) {
		push('visual.architecture.shared_ui_control_regression', 'Repeated shared UI control styling regression', 'Default-looking links or buttons repeat across multiple routes. Treat this as a shared UI package styling/component contract issue first.', '@treeseed/ui', { findingCodes: ['visual.display.default_link_style', 'visual.display.default_button_style'] });
	}
	if (new Set(findings.filter((entry) => entry.code === 'visual.functional.auth_redirect_unexpected').map((entry) => entry.path)).size >= 3) {
		push('visual.architecture.admin_shell_regression', 'Repeated authenticated route redirect regression', 'Multiple authenticated app routes redirected to auth. Inspect admin session/shell behavior before fixing individual pages.', '@treeseed/admin', {});
	}
	if (new Set(findings.filter((entry) => entry.code === 'visual.functional.seeded_entity_missing').map((entry) => entry.path)).size >= 3) {
		push('visual.architecture.api_fixture_or_access_regression', 'Repeated seeded entity visibility regression', 'Seeded fixture entities are missing on multiple app routes. Verify API fixture/session/data behavior before page-local fixes.', '@treeseed/api', {});
	}
	return output;
}

export function severityRank(value: TreeseedSceneVisualAuditFindingSeverity) {
	return SEVERITIES.indexOf(value);
}

export function filteredFindings(findings: TreeseedSceneVisualAuditFinding[], detail: TreeseedSceneVisualAuditReviewDetail, maxFindings: number) {
	const sorted = [...findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
	const byDetail = detail === 'summary' ? sorted.filter((entry) => entry.severity === 'blocking' || entry.severity === 'high') : sorted;
	return byDetail.slice(0, maxFindings);
}

export function expectedFindingNoise(findingEntry: TreeseedSceneVisualAuditFinding) {
	if (findingEntry.pathRoot !== '/404') return false;
	if (findingEntry.code === 'visual.functional.http_error') return true;
	if (findingEntry.code === 'visual.display.visible_error_text') return true;
	if (findingEntry.code === 'visual.client.console_error' && /404|not found/iu.test(findingEntry.message)) return true;
	return false;
}

export function messageSignature(findingEntry: TreeseedSceneVisualAuditFinding) {
	const evidence = JSON.stringify(findingEntry.evidence);
	if (/ENOENT.+starlight\/routes\/ssr/isu.test(findingEntry.message) || /starlight\/routes\/ssr/iu.test(evidence)) return 'missing-starlight-ssr-vendor';
	if (/HTTP\s+500/iu.test(findingEntry.message) || findingEntry.message.includes('Internal Server Error')) return 'http-500';
	if (/HTTP\s+404|status of 404|not found/iu.test(findingEntry.message)) return 'http-404';
	if (/ERR_ABORTED/iu.test(findingEntry.message)) return 'request-aborted';
	if (/hydration|runtime|react|astro|vite/iu.test(findingEntry.message)) return 'client-runtime';
	return findingEntry.message.replace(/\bhttps?:\/\/\S+/giu, '<url>').replace(/\s+/gu, ' ').slice(0, 90);
}

export function rootCauseKey(findingEntry: TreeseedSceneVisualAuditFinding) {
	if (findingEntry.category === 'architecture') return `${findingEntry.code}|${findingEntry.suspectedOwner}`;
	if (findingEntry.code === 'visual.display.default_link_style' || findingEntry.code === 'visual.display.default_button_style') return `${findingEntry.code}|${findingEntry.suspectedOwner}|shared-controls`;
	if (findingEntry.code === 'visual.functional.seeded_entity_missing') return `${findingEntry.code}|${findingEntry.suspectedOwner}|${findingEntry.pathRoot}`;
	if (findingEntry.code === 'visual.functional.final_url_mismatch') return `${findingEntry.code}|${findingEntry.suspectedOwner}|${findingEntry.pathRoot}`;
	if (findingEntry.category === 'client-error' || findingEntry.code === 'visual.functional.http_error' || findingEntry.code === 'visual.display.visible_error_text' || findingEntry.code === 'visual.display.blank_or_low_content') {
		return `visual.runtime_or_empty_route|${findingEntry.suspectedOwner}|${findingEntry.pathRoot}|${messageSignature(findingEntry)}`;
	}
	return `${findingEntry.code}|${findingEntry.suspectedOwner}|${findingEntry.pathRoot}`;
}

export function compactList<T extends string>(values: T[]) {
	return [...new Set(values)].sort();
}

export function rootCauseTitle(findings: TreeseedSceneVisualAuditFinding[]) {
	const first = findings[0];
	if (!first) return 'Visual audit finding cluster';
	if (first.code === 'visual.display.default_link_style' || first.code === 'visual.display.default_button_style') return 'Shared UI controls are falling back to browser-default styling';
	if (first.code === 'visual.functional.seeded_entity_missing') return 'Seeded visual-audit entities are missing from app routes';
	if (first.code === 'visual.functional.final_url_mismatch') return 'Routes end at unexpected final URLs';
	if (messageSignature(first) === 'missing-starlight-ssr-vendor') return 'Routes fail because the Core/Starlight SSR vendor file is missing';
	if (messageSignature(first) === 'http-500') return 'Routes return HTTP 500';
	if (messageSignature(first) === 'http-404') return 'Routes return HTTP 404';
	if (messageSignature(first) === 'request-aborted') return 'Requests abort during navigation';
	if (messageSignature(first) === 'client-runtime') return 'Client runtime errors are visible in the browser';
	if (first.code === 'visual.display.blank_or_low_content') return 'Routes render blank or very low-content pages';
	return first.title;
}

export function rootCauseMessage(findings: TreeseedSceneVisualAuditFinding[]) {
	const first = findings[0];
	if (!first) return '';
	const paths = compactList(findings.map((entry) => entry.path));
	const roles = compactList(findings.map((entry) => entry.role));
	const devices = compactList(findings.map((entry) => entry.device));
	return `${first.message} Seen ${findings.length} time(s) across ${paths.length} path(s), ${roles.length} role(s), and ${devices.length} device profile(s).`;
}

export function buildRootCauses(findings: TreeseedSceneVisualAuditFinding[]) {
	const grouped = new Map<string, TreeseedSceneVisualAuditFinding[]>();
	for (const findingEntry of findings) {
		const key = rootCauseKey(findingEntry);
		const list = grouped.get(key) ?? [];
		list.push(findingEntry);
		grouped.set(key, list);
	}
	const output: TreeseedSceneVisualAuditRootCause[] = [];
	let index = 0;
	for (const list of grouped.values()) {
		const sorted = [...list].sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.path.localeCompare(b.path));
		const first = sorted[0];
		if (!first) continue;
		const pathRoots = compactList(sorted.map((entry) => entry.pathRoot));
		const paths = compactList(sorted.map((entry) => entry.path));
		const roles = compactList(sorted.map((entry) => entry.role));
		const devices = compactList(sorted.map((entry) => entry.device));
		const captureIds = compactList(sorted.map((entry) => entry.captureId));
		const severity = sorted.reduce((best, entry) => severityRank(entry.severity) < severityRank(best) ? entry.severity : best, first.severity);
		const score = priorityScore({
			severity,
			category: first.category,
			owner: first.suspectedOwner,
			count: sorted.length,
			pathCount: paths.length,
			roleCount: roles.length,
			deviceCount: devices.length,
			code: first.code,
		});
		output.push({
			id: `root-cause-${String(index += 1).padStart(3, '0')}`,
			severity,
			category: first.category,
			code: first.code,
			title: rootCauseTitle(sorted),
			message: rootCauseMessage(sorted),
			suspectedOwner: first.suspectedOwner,
			count: sorted.length,
			pathRoots,
			paths,
			roles,
			devices,
			findingIds: sorted.map((entry) => entry.id),
			captureIds,
			exampleScreenshotPath: sorted.find((entry) => entry.screenshotPath)?.screenshotPath ?? null,
			architectureGuidance: first.architectureGuidance,
			recommendedAction: recommendedAction(first.suspectedOwner, first.code),
			priorityScore: score,
			priorityRank: 0,
			impact: {
				pathCount: paths.length,
				roleCount: roles.length,
				deviceCount: devices.length,
				captureCount: captureIds.length,
			},
			query: {
				owner: first.suspectedOwner,
				severity,
				code: first.code,
				pathRoots,
			},
		});
	}
	return output.sort((a, b) => b.priorityScore - a.priorityScore || severityRank(a.severity) - severityRank(b.severity) || b.count - a.count || a.title.localeCompare(b.title))
		.map((entry, priorityRank) => ({ ...entry, priorityRank: priorityRank + 1 }));
}
