import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { TreeseedGuaranteeDevice, TreeseedGuaranteeDiagnostic, TreeseedGuaranteeDiagnosticSeverity, TreeseedGuaranteeFilter, TreeseedGuaranteeGate, TreeseedGuaranteeManifest, TreeseedGuaranteePlanEntry, TreeseedGuaranteeStatus, TreeseedGuaranteeSurface, TreeseedGuaranteeVerifierDefinition, TreeseedGuaranteeVerifierKind, TreeseedLoadedGuarantee } from './treeseed-guarantee-schema-version.ts';

export type TreeseedGuaranteeJourneyAuditItem = {
	guaranteeId: string;
	status: TreeseedGuaranteeStatus;
	ownerPackage: string;
	type: string;
	subtype: string;
	journey: string;
	sourcePath: string;
	scenePath?: string;
	currentRoute?: string;
	resolvedRoute?: string;
	routeExists: boolean;
	sceneWorkflowStepCount: number;
	interactiveStepCount: number;
	classification:
		| 'valid-service-journey'
		| 'weak-page-only-scene'
		| 'route-mismatch'
		| 'missing-product-route'
		| 'missing-stable-selectors'
		| 'planned-product-contract'
		| 'non-ui-guarantee';
	requiredAction: 'author-scene' | 'fix-route' | 'add-selectors' | 'downgrade-status' | 'none';
	diagnostics: TreeseedGuaranteeDiagnostic[];
};

export type TreeseedGuaranteeRunState = {
	schemaVersion: 'treeseed.guarantee-run-state/v1';
	runId: string;
	values: Record<string, {
		producerGuaranteeId: string;
		kind: 'user' | 'team' | 'project' | 'host' | 'capacity-provider' | 'workday' | 'operation' | 'content' | 'custom';
		value: unknown;
		createdAt: string;
	}>;
};

export type TreeseedGuaranteeVerifierResolution = {
	ref: string;
	resolved: boolean;
	sourcePath?: string;
	ownerPackage?: string;
	definition?: TreeseedGuaranteeVerifierDefinition;
};

export type TreeseedGuaranteeVerifierResolutionReport = {
	ok: boolean;
	resolutions: TreeseedGuaranteeVerifierResolution[];
	diagnostics: TreeseedGuaranteeDiagnostic[];
};

export type TreeseedGuaranteeRunStatus = 'passed' | 'failed' | 'skipped' | 'blocked';

export type TreeseedGuaranteeRunStep = {
	id: string;
	kind: 'scene' | 'api' | 'content' | 'audit' | 'negative-case' | 'verifier';
	status: TreeseedGuaranteeRunStatus;
	ref?: string;
	summary?: string;
	evidence?: string[];
	diagnostics?: TreeseedGuaranteeDiagnostic[];
	startedAt?: string;
	completedAt?: string;
};

export type TreeseedGuaranteeRunResult = {
	id: string;
	journeyIndex?: number;
	type: string;
	subtype: string;
	journey: string;
	ownerPackage: string;
	status: TreeseedGuaranteeRunStatus;
	selected: boolean;
	dependency: boolean;
	sourcePath: string;
	startedAt: string;
	completedAt: string;
	steps: TreeseedGuaranteeRunStep[];
	evidence: string[];
	diagnostics: TreeseedGuaranteeDiagnostic[];
};

export type TreeseedGuaranteeRunReport = {
	ok: boolean;
	runId: string;
	workspaceRoot: string;
	environment: string;
	filter: TreeseedGuaranteeFilter;
	startedAt: string;
	completedAt: string;
	outputRoot: string;
	statePath?: string;
	plan: TreeseedGuaranteePlanReport;
	results: TreeseedGuaranteeRunResult[];
	diagnostics: TreeseedGuaranteeDiagnostic[];
	counts: {
		planned: number;
		passed: number;
		failed: number;
		skipped: number;
		blocked: number;
		releaseBlockingFailures: number;
	};
};

export type TreeseedGuaranteeReportWriteResult = {
	ok: boolean;
	outputRoot: string;
	planPath: string;
	reportPath: string;
	markdownPath: string;
	csvPath: string;
	diagnostics: TreeseedGuaranteeDiagnostic[];
};

export type TreeseedGuaranteeVerifierExecutionInput = {
	workspaceRoot: string;
	environment: string;
	runId: string;
	outputRoot: string;
	guarantee: TreeseedLoadedGuarantee & { manifest: TreeseedGuaranteeManifest };
	ref: string;
	definition: TreeseedGuaranteeVerifierDefinition;
	kind: TreeseedGuaranteeRunStep['kind'];
	onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
};

export type TreeseedGuaranteeVerifierExecutionResult = {
	status: TreeseedGuaranteeRunStatus;
	summary?: string;
	evidence?: string[];
	diagnostics?: TreeseedGuaranteeDiagnostic[];
};

export type TreeseedGuaranteeVerifierExecutor = (input: TreeseedGuaranteeVerifierExecutionInput) => Promise<TreeseedGuaranteeVerifierExecutionResult>;

export type TreeseedGuaranteeSceneExecutionInput = {
	workspaceRoot: string;
	environment: string;
	runId: string;
	outputRoot: string;
	guarantee: TreeseedLoadedGuarantee & { manifest: TreeseedGuaranteeManifest };
	scenePath: string;
	record?: boolean;
	artifactMode?: 'full' | 'screenshots';
	device?: string;
};

export type TreeseedGuaranteeSceneExecutor = (input: TreeseedGuaranteeSceneExecutionInput) => Promise<TreeseedGuaranteeVerifierExecutionResult>;

export type TreeseedGuaranteePlanReport = {
	ok: boolean;
	workspaceRoot: string;
	filter: TreeseedGuaranteeFilter;
	environment: string;
	entries: TreeseedGuaranteePlanEntry[];
	diagnostics: TreeseedGuaranteeDiagnostic[];
	counts: {
		total: number;
		selected: number;
		withDependencies: number;
		errors: number;
		warnings: number;
	};
};

export const TAXONOMY_PATTERN = /^[a-z][a-z0-9-]*$/u;

export const GUARANTEE_ID_PATTERN = /^guarantee\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){2,}\.\d{3}$/u;

export const KNOWN_GATES = new Set<TreeseedGuaranteeGate>(['smoke', 'core', 'release', 'security', 'migration', 'demo', 'backlog', 'future']);

export const KNOWN_STATUSES = new Set<TreeseedGuaranteeStatus>(['active', 'planned', 'blocked', 'backlog', 'deprecated']);

export const KNOWN_SURFACES = new Set<TreeseedGuaranteeSurface>(['admin-ui', 'agent-runtime', 'api-control-plane', 'market-ui', 'cli', 'scene', 'content-runtime']);

export const KNOWN_DEVICES = new Set<TreeseedGuaranteeDevice>(['desktop_chromium', 'desktop_firefox', 'desktop_webkit', 'tablet_chromium', 'mobile_chromium', 'mobile_webkit']);

export const KNOWN_VERIFIER_KINDS = new Set<TreeseedGuaranteeVerifierKind>(['apiAcceptanceCase', 'vitestCase', 'nodeScript', 'packageScript', 'scene', 'manualEvidence', 'todo']);

export const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'build', '.treeseed', 'coverage']);

export function diagnostic(severity: TreeseedGuaranteeDiagnosticSeverity, code: string, message: string, path?: string, sourcePath?: string): TreeseedGuaranteeDiagnostic {
	return { severity, code, message, ...(path ? { path } : {}), ...(sourcePath ? { sourcePath } : {}) };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function arrayOrEmpty<T>(value: T[] | null | undefined): T[] {
	return value ?? [];
}

export function stringValue(value: unknown) {
	return typeof value === 'string' ? value.trim() : '';
}

export function stringArray(value: unknown) {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => stringValue(entry)).filter(Boolean);
}

export function numberArray(value: unknown) {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => Number(entry)).filter((entry) => Number.isInteger(entry));
}

export function numberValue(value: unknown) {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : undefined;
}

export function sortedUnique(values: string[]) {
	return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function normalizeTreeseedGuaranteeTaxonomy(value: string) {
	return value.trim()
		.replace(/TreeDX/gu, 'treedx')
		.replace(/tree[\s_-]*dx/giu, 'treedx')
		.replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
		.replace(/[_\s]+/gu, '-')
		.toLowerCase()
		.replace(/[^a-z0-9-]+/gu, '-')
		.replace(/^-|-$/gu, '')
		.replace(/-{2,}/gu, '-');
}

export function slugifyTreeseedGuaranteeJourney(value: string) {
	return normalizeTreeseedGuaranteeTaxonomy(value.replace(/&/gu, 'and'));
}

export function readYamlFile(filePath: string, diagnostics: TreeseedGuaranteeDiagnostic[]) {
	try {
		return parseYaml(readFileSync(filePath, 'utf8')) as unknown;
	} catch (error) {
		diagnostics.push(diagnostic('error', 'guarantee.yaml_parse_error', error instanceof Error ? error.message : String(error), 'manifest', filePath));
		return null;
	}
}
