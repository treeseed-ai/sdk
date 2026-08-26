import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parse } from 'yaml';

export type GuaranteeRunStatus = 'passed' | 'failed' | 'skipped' | 'blocked';
export type GuaranteeFilter = Record<string, unknown>;
export interface GuaranteeDiagnostic { severity: 'error' | 'warning' | 'info'; code: string; message: string; path?: string; sourcePath?: string; }
export interface GuaranteeRunStep { id: string; kind: string; status: GuaranteeRunStatus; evidence?: string[]; diagnostics?: GuaranteeDiagnostic[]; [key: string]: unknown; }
export interface GuaranteePlanEntry { id: string; journey: string; ownerPackage: string; type: string; subtype: string; status: string; gates: string[]; sourcePath: string; selected: boolean; dependency: boolean; [key: string]: unknown; }
export interface GuaranteePlanReport { ok: boolean; entries: GuaranteePlanEntry[]; diagnostics: GuaranteeDiagnostic[]; [key: string]: unknown; }
export interface GuaranteeRunResult { id: string; journey: string; ownerPackage: string; type: string; subtype: string; status: GuaranteeRunStatus; selected: boolean; dependency: boolean; sourcePath: string; steps: GuaranteeRunStep[]; diagnostics: GuaranteeDiagnostic[]; evidence: string[]; [key: string]: unknown; }
export interface GuaranteeRunReport { runId: string; environment: string; startedAt: string; completedAt?: string; ok: boolean; filter: GuaranteeFilter; counts: { passed: number; failed: number; skipped: number; blocked: number; releaseBlockingFailures: number }; results: GuaranteeRunResult[]; diagnostics?: GuaranteeDiagnostic[]; [key: string]: unknown; }

interface GuaranteeManifest { id: string; journey: string; ownerPackage: string; type: string; subtype: string; status: string; gates: string[]; [key: string]: unknown; }
interface LoadedGuarantee { sourcePath: string; relativePath: string; manifest: GuaranteeManifest | null; }

function walk(root: string, out: string[] = []) {
	if (!existsSync(root)) return out;
	for (const name of readdirSync(root)) {
		if (['.git', 'node_modules', 'dist'].includes(name)) continue;
		const path = resolve(root, name); const stat = statSync(path);
		if (stat.isDirectory()) walk(path, out); else if (name.endsWith('.guarantee.yaml') || name.endsWith('.guarantee.yml')) out.push(path);
	}
	return out;
}

export function discoverGuarantees(input: { workspaceRoot: string; filter?: GuaranteeFilter }) {
	const diagnostics: GuaranteeDiagnostic[] = [];
	const guarantees: LoadedGuarantee[] = walk(resolve(input.workspaceRoot)).map((sourcePath) => {
		try {
			const value = parse(readFileSync(sourcePath, 'utf8')) as Record<string, unknown>;
			const manifest: GuaranteeManifest = { ...value, id: String(value.id ?? ''), journey: String(value.journey ?? value.id ?? ''),
				ownerPackage: String(value.ownerPackage ?? ''), type: String(value.type ?? ''), subtype: String(value.subtype ?? ''),
				status: String(value.status ?? 'planned'), gates: Array.isArray(value.gates) ? value.gates.map(String) : [] };
			if (!manifest.id) throw new Error('id is required');
			return { sourcePath, relativePath: relative(input.workspaceRoot, sourcePath).replaceAll('\\', '/'), manifest };
		} catch (cause) {
			diagnostics.push({ severity: 'error', code: 'guarantee.invalid_manifest', message: cause instanceof Error ? cause.message : 'Invalid guarantee manifest.', sourcePath });
			return { sourcePath, relativePath: relative(input.workspaceRoot, sourcePath).replaceAll('\\', '/'), manifest: null };
		}
	});
	return { ok: diagnostics.every((entry) => entry.severity !== 'error'), guarantees, diagnostics, counts: { total: guarantees.length } };
}
