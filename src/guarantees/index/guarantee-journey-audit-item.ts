import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { GuaranteeDevice, GuaranteeDiagnostic, GuaranteeDiagnosticSeverity, GuaranteeFilter, GuaranteeGate, GuaranteeManifest, GuaranteePlanEntry, GuaranteeStatus, GuaranteeSurface, GuaranteeVerifierDefinition, GuaranteeVerifierKind, LoadedGuarantee } from './guarantee-schema-version.ts';

export type GuaranteeJourneyAuditItem = {
	guaranteeId: string;
	status: GuaranteeStatus;
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
	diagnostics: GuaranteeDiagnostic[];
};

export type GuaranteeRunState = {
	schemaVersion: 'treeseed.guarantee-run-state/v1';
	runId: string;
	values: Record<string, {
		producerGuaranteeId: string;
		kind: 'user' | 'team' | 'project' | 'host' | 'capacity-provider' | 'workday' | 'operation' | 'content' | 'custom';
		value: unknown;
		createdAt: string;
	}>;
};

export type GuaranteeVerifierResolution = {
	ref: string;
	resolved: boolean;
	sourcePath?: string;
	ownerPackage?: string;
	definition?: GuaranteeVerifierDefinition;
};

export type GuaranteeVerifierResolutionReport = {
	ok: boolean;
	resolutions: GuaranteeVerifierResolution[];
	diagnostics: GuaranteeDiagnostic[];
};

export type GuaranteeRunStatus = 'passed' | 'failed' | 'skipped' | 'blocked';

export type GuaranteeRunStep = {
	id: string;
	kind: 'scene' | 'api' | 'content' | 'audit' | 'negative-case' | 'verifier';
	status: GuaranteeRunStatus;
	ref?: string;
	summary?: string;
	evidence?: string[];
	diagnostics?: GuaranteeDiagnostic[];
	startedAt?: string;
	completedAt?: string;
};

export type GuaranteeRunResult = {
	id: string;
	journeyIndex?: number;
	type: string;
	subtype: string;
	journey: string;
	ownerPackage: string;
	status: GuaranteeRunStatus;
	selected: boolean;
	dependency: boolean;
	sourcePath: string;
	startedAt: string;
	completedAt: string;
	steps: GuaranteeRunStep[];
	evidence: string[];
	diagnostics: GuaranteeDiagnostic[];
};

export type GuaranteeRunReport = {
	ok: boolean;
	runId: string;
	workspaceRoot: string;
	environment: string;
	filter: GuaranteeFilter;
	startedAt: string;
	completedAt: string;
	outputRoot: string;
	statePath?: string;
	plan: GuaranteePlanReport;
	results: GuaranteeRunResult[];
	diagnostics: GuaranteeDiagnostic[];
	counts: {
		planned: number;
		passed: number;
		failed: number;
		skipped: number;
		blocked: number;
		releaseBlockingFailures: number;
	};
};

export type GuaranteeReportWriteResult = {
	ok: boolean;
	outputRoot: string;
	planPath: string;
	reportPath: string;
	markdownPath: string;
	csvPath: string;
	diagnostics: GuaranteeDiagnostic[];
};

export type GuaranteeVerifierExecutionInput = {
	workspaceRoot: string;
	environment: string;
	runId: string;
	outputRoot: string;
	guarantee: LoadedGuarantee & { manifest: GuaranteeManifest };
	ref: string;
	definition: GuaranteeVerifierDefinition;
	kind: GuaranteeRunStep['kind'];
	onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
};

export type GuaranteeVerifierExecutionResult = {
	status: GuaranteeRunStatus;
	summary?: string;
	evidence?: string[];
	diagnostics?: GuaranteeDiagnostic[];
};

export type GuaranteeVerifierExecutor = (input: GuaranteeVerifierExecutionInput) => Promise<GuaranteeVerifierExecutionResult>;

export type GuaranteeSceneExecutionInput = {
	workspaceRoot: string;
	environment: string;
	runId: string;
	outputRoot: string;
	guarantee: LoadedGuarantee & { manifest: GuaranteeManifest };
	scenePath: string;
	record?: boolean;
	artifactMode?: 'full' | 'screenshots';
	device?: string;
};

export type GuaranteeSceneExecutor = (input: GuaranteeSceneExecutionInput) => Promise<GuaranteeVerifierExecutionResult>;

export type GuaranteePlanReport = {
	ok: boolean;
	workspaceRoot: string;
	filter: GuaranteeFilter;
	environment: string;
	entries: GuaranteePlanEntry[];
	diagnostics: GuaranteeDiagnostic[];
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

export const KNOWN_GATES = new Set<GuaranteeGate>(['smoke', 'core', 'release', 'security', 'migration', 'demo', 'backlog', 'future']);

export const KNOWN_STATUSES = new Set<GuaranteeStatus>(['active', 'planned', 'blocked', 'backlog', 'deprecated']);

export const KNOWN_SURFACES = new Set<GuaranteeSurface>(['admin-ui', 'agent-runtime', 'api-control-plane', 'market-ui', 'cli', 'scene', 'content-runtime']);

export const KNOWN_DEVICES = new Set<GuaranteeDevice>(['desktop_chromium', 'desktop_firefox', 'desktop_webkit', 'tablet_chromium', 'mobile_chromium', 'mobile_webkit']);

export const KNOWN_VERIFIER_KINDS = new Set<GuaranteeVerifierKind>(['apiAcceptanceCase', 'vitestCase', 'nodeScript', 'packageScript', 'scene', 'manualEvidence', 'todo']);

export const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'build', '.treeseed', 'coverage']);

export function diagnostic(severity: GuaranteeDiagnosticSeverity, code: string, message: string, path?: string, sourcePath?: string): GuaranteeDiagnostic {
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

export function normalizeGuaranteeTaxonomy(value: string) {
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

export function slugifyGuaranteeJourney(value: string) {
	return normalizeGuaranteeTaxonomy(value.replace(/&/gu, 'and'));
}

export function readYamlFile(filePath: string, diagnostics: GuaranteeDiagnostic[]) {
	try {
		return parseYaml(readFileSync(filePath, 'utf8')) as unknown;
	} catch (error) {
		diagnostics.push(diagnostic('error', 'guarantee.yaml_parse_error', error instanceof Error ? error.message : String(error), 'manifest', filePath));
		return null;
	}
}
