import { mkdirSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import type {
	SceneVisualAuditCapture,
	SceneVisualAuditFinding,
	SceneVisualAuditManifest,
	SceneVisualAuditPaths,
	SceneVisualAuditReview,
	SceneVisualAuditRootCause,
} from '../../types.ts';

function esc(value: unknown) {
	return String(value ?? '')
		.replace(/&/gu, '&amp;')
		.replace(/</gu, '&lt;')
		.replace(/>/gu, '&gt;')
		.replace(/"/gu, '&quot;');
}

function slug(value: string) {
	return value === '/' ? 'root' : value.replace(/^\/+|\/+$/gu, '').replace(/[^a-z0-9]+/giu, '-').toLowerCase() || 'root';
}

function rel(from: string, path: string | null) {
	return path ? relative(from, path) : '';
}

function styles() {
	return `<style>
body{margin:0;background:#0f172a;color:#e2e8f0;font:14px/1.45 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
a{color:#38bdf8}
header{position:sticky;top:0;background:#111827f2;border-bottom:1px solid #334155;padding:16px 22px;z-index:2}
h1{margin:0 0 8px;font-size:22px} h2{margin:28px 22px 12px;font-size:18px}
.meta{color:#cbd5e1}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;padding:0 22px 24px}
.card{background:#1e293b;border:1px solid #334155;border-radius:8px;overflow:hidden;box-shadow:0 12px 30px #0004}
.shot{display:block;background:#020617;aspect-ratio:16/10;overflow:hidden}.shot img{width:100%;height:100%;object-fit:contain;display:block}
.body{padding:12px}.path{font-weight:700;color:#f8fafc}.sub{color:#cbd5e1;font-size:12px;margin-top:4px}.badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.badge{font-size:11px;border-radius:999px;padding:3px 8px;background:#334155;color:#e2e8f0}.blocking,.high{background:#7f1d1d;color:#fecaca}.medium{background:#78350f;color:#fde68a}.low{background:#164e63;color:#bae6fd}.info{background:#365314;color:#d9f99d}
.finding{font-size:12px;margin-top:8px;color:#f8fafc}.empty{padding:22px;color:#cbd5e1}
.action{font-size:12px;margin-top:8px;color:#cbd5e1}.rank{background:#0f766e;color:#ccfbf1}.owner{background:#312e81;color:#ddd6fe}
nav{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
nav a{border:1px solid #334155;border-radius:999px;padding:4px 10px;text-decoration:none;color:#e2e8f0}
</style>`;
}

function renderPage(input: {
	title: string;
	manifest: SceneVisualAuditManifest;
	paths: SceneVisualAuditPaths;
	captures: SceneVisualAuditCapture[];
	findings: SceneVisualAuditFinding[];
	allRoots: string[];
}) {
	const reviewRoot = input.paths.reviewRoot!;
	const findingsByCapture = new Map<string, SceneVisualAuditFinding[]>();
	for (const finding of input.findings) {
		const list = findingsByCapture.get(finding.captureId) ?? [];
		list.push(finding);
		findingsByCapture.set(finding.captureId, list);
	}
	const nav = [
		`<a href="index.html">All</a>`,
		`<a href="flagged.html">Flagged</a>`,
		...input.allRoots.map((root) => `<a href="${slug(root)}.html">${esc(root)}</a>`),
	].join('');
	const cards = input.captures.map((capture) => {
		const list = findingsByCapture.get(capture.id) ?? [];
		const image = capture.screenshotPath ? rel(reviewRoot, capture.screenshotPath) : '';
		const badges = list.slice(0, 5).map((finding) => `<span class="badge ${esc(finding.severity)}">${esc(finding.severity)} ${esc(finding.code.replace(/^visual\./u, ''))}</span>`).join('');
		const findingText = list[0] ? `<div class="finding">${esc(list[0].message)}</div>` : '';
		return `<article class="card">
${image ? `<a class="shot" href="${esc(image)}"><img src="${esc(image)}" alt="${esc(capture.path)} ${esc(capture.role)} ${esc(capture.device)}"></a>` : '<div class="shot empty">No screenshot</div>'}
<div class="body">
<div class="path">${esc(capture.path)}</div>
<div class="sub">${esc(capture.role)} / ${esc(capture.device)} / ${esc(capture.status)} / ${esc(capture.finalUrl ?? capture.url)}</div>
${badges ? `<div class="badges">${badges}</div>` : ''}
${findingText}
</div>
</article>`;
	}).join('\n');
	return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(input.title)}</title>${styles()}</head>
<body>
<header>
<h1>${esc(input.title)}</h1>
<div class="meta">Scene ${esc(input.manifest.sceneId)} / audit ${esc(input.manifest.auditId)} / captures ${input.captures.length} / findings ${input.findings.length}</div>
<nav>${nav}</nav>
</header>
${cards ? `<main class="grid">${cards}</main>` : '<main class="empty">No captures in this sheet.</main>'}
</body>
</html>
`;
}

function renderRootCausePage(input: {
	manifest: SceneVisualAuditManifest;
	paths: SceneVisualAuditPaths;
	rootCauses: SceneVisualAuditRootCause[];
}) {
	const reviewRoot = input.paths.reviewRoot!;
	const nav = `<a href="index.html">All</a><a href="flagged.html">Flagged</a><a href="root-causes.html">Root causes</a>`;
	const cards = input.rootCauses.map((entry) => {
		const image = entry.exampleScreenshotPath ? rel(reviewRoot, entry.exampleScreenshotPath) : '';
		return `<article class="card" id="${esc(entry.id)}">
${image ? `<a class="shot" href="${esc(image)}"><img src="${esc(image)}" alt="${esc(entry.title)}"></a>` : '<div class="shot empty">No screenshot</div>'}
<div class="body">
<div class="path">#${esc(entry.priorityRank)} ${esc(entry.title)}</div>
<div class="sub">${esc(entry.suspectedOwner)} / ${esc(entry.severity)} / score ${esc(entry.priorityScore)} / count ${esc(entry.count)}</div>
<div class="badges"><span class="badge rank">rank ${esc(entry.priorityRank)}</span><span class="badge owner">${esc(entry.suspectedOwner)}</span><span class="badge ${esc(entry.severity)}">${esc(entry.severity)}</span></div>
<div class="finding">${esc(entry.paths.slice(0, 8).join(', '))}</div>
<div class="action">${esc(entry.recommendedAction)}</div>
</div>
</article>`;
	}).join('\n');
	return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visual Audit Root Causes</title>${styles()}</head>
<body>
<header>
<h1>Visual Audit Root Causes</h1>
<div class="meta">Scene ${esc(input.manifest.sceneId)} / audit ${esc(input.manifest.auditId)} / root causes ${input.rootCauses.length}</div>
<nav>${nav}</nav>
</header>
${cards ? `<main class="grid">${cards}</main>` : '<main class="empty">No root causes.</main>'}
</body>
</html>
`;
}

export function writeSceneVisualAuditContactSheets(input: {
	manifest: SceneVisualAuditManifest;
	review: SceneVisualAuditReview;
	paths: SceneVisualAuditPaths;
}) {
	if (!input.paths.reviewRoot) return;
	const root = `${input.paths.reviewRoot}/contact-sheets`;
	mkdirSync(root, { recursive: true });
	const roots = [...new Set(input.manifest.routes.map((route) => route.pathRoot))].sort();
	const write = (name: string, title: string, captures: SceneVisualAuditCapture[], findings = input.review.findings) => {
		writeFileSync(`${root}/${name}.html`, renderPage({ title, manifest: input.manifest, paths: input.paths, captures, findings, allRoots: roots }), 'utf8');
	};
	write('index', 'Visual Audit Contact Sheets', input.manifest.captures);
	const flaggedIds = new Set(input.review.findings.map((finding) => finding.captureId));
	write('flagged', 'Flagged Visual Audit Captures', input.manifest.captures.filter((capture) => flaggedIds.has(capture.id)));
	writeFileSync(`${root}/root-causes.html`, renderRootCausePage({ manifest: input.manifest, paths: input.paths, rootCauses: input.review.rootCauses }), 'utf8');
	for (const pathRoot of roots) {
		write(slug(pathRoot), `Visual Audit ${pathRoot}`, input.manifest.captures.filter((capture) => capture.pathRoot === pathRoot));
	}
}
