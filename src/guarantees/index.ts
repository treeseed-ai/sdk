import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { parse as parseYaml } from 'yaml';

export const TREESEED_GUARANTEE_SCHEMA_VERSION = 'treeseed.guarantee/v1' as const;
export const TREESEED_GUARANTEE_VERIFIERS_SCHEMA_VERSION = 'treeseed.guarantee-verifiers/v1' as const;

export type TreeseedGuaranteeSchemaVersion = typeof TREESEED_GUARANTEE_SCHEMA_VERSION;
export type TreeseedGuaranteeVerifiersSchemaVersion = typeof TREESEED_GUARANTEE_VERIFIERS_SCHEMA_VERSION;

export type TreeseedGuaranteeGate = 'smoke' | 'core' | 'release' | 'security' | 'migration' | 'demo' | 'backlog' | 'future';
export type TreeseedGuaranteeStatus = 'active' | 'planned' | 'blocked' | 'backlog' | 'deprecated';
export type TreeseedGuaranteeSurface =
	| 'admin-ui'
	| 'agent-runtime'
	| 'api-control-plane'
	| 'market-ui'
	| 'cli'
	| 'scene'
	| 'content-runtime';
export type TreeseedGuaranteeDevice =
	| 'desktop_chromium'
	| 'desktop_firefox'
	| 'desktop_webkit'
	| 'tablet_chromium'
	| 'mobile_chromium'
	| 'mobile_webkit';

export type TreeseedGuaranteeDiagnosticSeverity = 'error' | 'warning';

export type TreeseedGuaranteeDiagnostic = {
	severity: TreeseedGuaranteeDiagnosticSeverity;
	code: string;
	message: string;
	path?: string;
	sourcePath?: string;
};

export type TreeseedGuaranteeVerifierContract = {
	required?: boolean;
	verifierRefs?: string[];
};

export type TreeseedGuaranteeApiContract = TreeseedGuaranteeVerifierContract;

export type TreeseedGuaranteeSceneContract = {
	required?: boolean;
	manifest?: string;
	mode?: {
		acceptance?: boolean;
		demo?: boolean;
		training?: boolean;
	};
	entryRoute?: string;
	componentContract?: string;
	expectedEvidence?: string[];
};

export type TreeseedGuaranteeNegativeCase = {
	id: string;
	actor?: string;
	verifierRefs?: string[];
	notes?: string[];
};

export type TreeseedGuaranteeDependencies = {
	journeys?: number[];
	guarantees?: string[];
};

export type TreeseedGuaranteeRunContract = {
	timeoutSeconds?: number;
	allowSkipped?: boolean;
	requiredForRelease?: boolean;
};

export type TreeseedGuaranteeManifest = {
	schemaVersion: TreeseedGuaranteeSchemaVersion;
	id: string;
	journeyIndex?: number;
	type: string;
	subtype: string;
	journey: string;
	ownerPackage: string;
	surface?: TreeseedGuaranteeSurface;
	summary: string;
	status: TreeseedGuaranteeStatus;
	run?: TreeseedGuaranteeRunContract;
	dependencies: TreeseedGuaranteeDependencies;
	actors: {
		allowed: string[];
		forbidden: string[];
	};
	devices: {
		required: TreeseedGuaranteeDevice[];
		optional?: TreeseedGuaranteeDevice[];
	};
	gates: TreeseedGuaranteeGate[];
	preconditions: {
		fixtures?: string[];
		notes?: string[];
	};
	scene?: TreeseedGuaranteeSceneContract;
	api?: TreeseedGuaranteeApiContract;
	content?: TreeseedGuaranteeVerifierContract;
	audit?: TreeseedGuaranteeVerifierContract;
	negativeCases?: TreeseedGuaranteeNegativeCase[];
	evidence: {
		required: string[];
		optional?: string[];
	};
	notes?: string[];
};

export type TreeseedLoadedGuarantee = {
	sourcePath: string;
	relativePath: string;
	packageRoot: string;
	ownerPackage: string;
	manifest: TreeseedGuaranteeManifest | null;
	diagnostics: TreeseedGuaranteeDiagnostic[];
};

export type TreeseedGuaranteeVerifierKind =
	| 'apiAcceptanceCase'
	| 'vitestCase'
	| 'nodeScript'
	| 'packageScript'
	| 'scene'
	| 'manualEvidence'
	| 'todo';

export type TreeseedGuaranteeVerifierDefinition = {
	kind: TreeseedGuaranteeVerifierKind;
	ownerPackage?: string;
	spec?: string;
	caseId?: string;
	command?: string;
	args?: string[];
	testFile?: string;
	testName?: string;
	cwd?: string;
	timeoutSeconds?: number;
	evidence?: string[];
	description?: string;
};

export type TreeseedGuaranteeVerifierRegistry = {
	schemaVersion: TreeseedGuaranteeVerifiersSchemaVersion;
	ownerPackage: string;
	verifiers: Record<string, TreeseedGuaranteeVerifierDefinition>;
};

export type TreeseedLoadedGuaranteeVerifierRegistry = {
	sourcePath: string;
	ownerPackage: string;
	registry: TreeseedGuaranteeVerifierRegistry | null;
	diagnostics: TreeseedGuaranteeDiagnostic[];
};

export type TreeseedGuaranteeFilter = {
	gate?: TreeseedGuaranteeGate;
	type?: string;
	subtype?: string;
	ownerPackage?: string;
	status?: TreeseedGuaranteeStatus;
	ids?: string[];
	journeyIndexes?: number[];
};

export type TreeseedGuaranteeRegistryReport = {
	ok: boolean;
	workspaceRoot: string;
	guarantees: TreeseedLoadedGuarantee[];
	verifierRegistries: TreeseedLoadedGuaranteeVerifierRegistry[];
	diagnostics: TreeseedGuaranteeDiagnostic[];
	counts: {
		total: number;
		valid: number;
		selected?: number;
		errors: number;
		warnings: number;
	};
};

export type TreeseedGuaranteePlanEntry = {
	id: string;
	journeyIndex?: number;
	type: string;
	subtype: string;
	journey: string;
	ownerPackage: string;
	surface?: TreeseedGuaranteeSurface;
	status: TreeseedGuaranteeStatus;
	gates: TreeseedGuaranteeGate[];
	sourcePath: string;
	selected: boolean;
	dependency: boolean;
	sceneManifest?: string;
	apiVerifierRefs: string[];
	contentVerifierRefs: string[];
	auditVerifierRefs: string[];
	evidenceRequired: string[];
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

const TAXONOMY_PATTERN = /^[a-z][a-z0-9-]*$/u;
const GUARANTEE_ID_PATTERN = /^guarantee\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){2,}\.\d{3}$/u;
const KNOWN_GATES = new Set<TreeseedGuaranteeGate>(['smoke', 'core', 'release', 'security', 'migration', 'demo', 'backlog', 'future']);
const KNOWN_STATUSES = new Set<TreeseedGuaranteeStatus>(['active', 'planned', 'blocked', 'backlog', 'deprecated']);
const KNOWN_SURFACES = new Set<TreeseedGuaranteeSurface>(['admin-ui', 'agent-runtime', 'api-control-plane', 'market-ui', 'cli', 'scene', 'content-runtime']);
const KNOWN_DEVICES = new Set<TreeseedGuaranteeDevice>(['desktop_chromium', 'desktop_firefox', 'desktop_webkit', 'tablet_chromium', 'mobile_chromium', 'mobile_webkit']);
const KNOWN_VERIFIER_KINDS = new Set<TreeseedGuaranteeVerifierKind>(['apiAcceptanceCase', 'vitestCase', 'nodeScript', 'packageScript', 'scene', 'manualEvidence', 'todo']);
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'build', '.treeseed', 'coverage']);
const execFileAsync = promisify(execFile);

function diagnostic(severity: TreeseedGuaranteeDiagnosticSeverity, code: string, message: string, path?: string, sourcePath?: string): TreeseedGuaranteeDiagnostic {
	return { severity, code, message, ...(path ? { path } : {}), ...(sourcePath ? { sourcePath } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown) {
	return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown) {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => stringValue(entry)).filter(Boolean);
}

function numberArray(value: unknown) {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => Number(entry)).filter((entry) => Number.isInteger(entry));
}

function numberValue(value: unknown) {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : undefined;
}

function sortedUnique(values: string[]) {
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

function readYamlFile(filePath: string, diagnostics: TreeseedGuaranteeDiagnostic[]) {
	try {
		return parseYaml(readFileSync(filePath, 'utf8')) as unknown;
	} catch (error) {
		diagnostics.push(diagnostic('error', 'guarantee.yaml_parse_error', error instanceof Error ? error.message : String(error), 'manifest', filePath));
		return null;
	}
}

function walkFiles(root: string, predicate: (path: string) => boolean): string[] {
	if (!existsSync(root)) return [];
	const results: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (EXCLUDED_DIRS.has(entry.name)) continue;
		const fullPath = resolve(root, entry.name);
		if (entry.isDirectory()) {
			if (fullPath.endsWith(`${sep}packages${sep}treedx${sep}guarantees`)) continue;
			results.push(...walkFiles(fullPath, predicate));
			continue;
		}
		if (entry.isFile() && predicate(fullPath)) results.push(fullPath);
	}
	return results.sort((a, b) => a.localeCompare(b));
}

function nearestPackageRoot(workspaceRoot: string, filePath: string) {
	const packagesRoot = resolve(workspaceRoot, 'packages');
	if (filePath.startsWith(`${packagesRoot}${sep}`)) {
		const [packageName] = relative(packagesRoot, filePath).split(sep);
		if (packageName) return resolve(packagesRoot, packageName);
	}
	return workspaceRoot;
}

function ownerPackageFromRoot(packageRoot: string) {
	const packageJson = resolve(packageRoot, 'package.json');
	if (existsSync(packageJson)) {
		try {
			const parsed = JSON.parse(readFileSync(packageJson, 'utf8')) as { name?: unknown };
			if (typeof parsed.name === 'string' && parsed.name.trim()) return parsed.name.trim();
		} catch {
			// Fall through to market root.
		}
	}
	return '@treeseed/market';
}

function validateTaxonomyPath(input: { workspaceRoot: string; sourcePath: string; manifest: TreeseedGuaranteeManifest; diagnostics: TreeseedGuaranteeDiagnostic[] }) {
	const packageRoot = nearestPackageRoot(input.workspaceRoot, input.sourcePath);
	const relativePath = relative(packageRoot, input.sourcePath).split(sep);
	const guaranteeIndex = relativePath.indexOf('guarantees');
	if (guaranteeIndex < 0 || relativePath.length < guaranteeIndex + 4) {
		input.diagnostics.push(diagnostic('error', 'guarantee.invalid_path', 'Guarantee files must live under guarantees/<type>/<subtype>/*.guarantee.yaml.', 'sourcePath', input.sourcePath));
		return;
	}
	const pathType = relativePath[guaranteeIndex + 1];
	const pathSubtype = relativePath[guaranteeIndex + 2];
	if (pathType === 'verifiers') return;
	if (pathType !== input.manifest.type) {
		input.diagnostics.push(diagnostic('error', 'guarantee.type_path_mismatch', `Guarantee type "${input.manifest.type}" must match directory "${pathType}".`, 'type', input.sourcePath));
	}
	if (pathSubtype !== input.manifest.subtype) {
		input.diagnostics.push(diagnostic('error', 'guarantee.subtype_path_mismatch', `Guarantee subtype "${input.manifest.subtype}" must match directory "${pathSubtype}".`, 'subtype', input.sourcePath));
	}
}

function parseContract(value: unknown): TreeseedGuaranteeVerifierContract | undefined {
	if (!isRecord(value)) return undefined;
	return {
		...(typeof value.required === 'boolean' ? { required: value.required } : {}),
		verifierRefs: stringArray(value.verifierRefs),
	};
}

function parseRunContract(value: unknown): TreeseedGuaranteeRunContract | undefined {
	if (!isRecord(value)) return undefined;
	const timeoutSeconds = numberValue(value.timeoutSeconds);
	return {
		...(timeoutSeconds && timeoutSeconds > 0 ? { timeoutSeconds } : {}),
		...(typeof value.allowSkipped === 'boolean' ? { allowSkipped: value.allowSkipped } : {}),
		...(typeof value.requiredForRelease === 'boolean' ? { requiredForRelease: value.requiredForRelease } : {}),
	};
}

function parseScene(value: unknown): TreeseedGuaranteeSceneContract | undefined {
	if (!isRecord(value)) return undefined;
	const mode = isRecord(value.mode) ? value.mode : {};
	return {
		...(typeof value.required === 'boolean' ? { required: value.required } : {}),
		...(typeof value.manifest === 'string' ? { manifest: value.manifest } : {}),
		...(isRecord(value.mode)
			? { mode: { acceptance: mode.acceptance === true, demo: mode.demo === true, training: mode.training === true } }
			: {}),
		...(typeof value.entryRoute === 'string' ? { entryRoute: value.entryRoute } : {}),
		...(typeof value.componentContract === 'string' ? { componentContract: value.componentContract } : {}),
		expectedEvidence: stringArray(value.expectedEvidence),
	};
}

function parseGuaranteeManifest(value: unknown, diagnostics: TreeseedGuaranteeDiagnostic[], sourcePath: string): TreeseedGuaranteeManifest | null {
	if (!isRecord(value)) {
		diagnostics.push(diagnostic('error', 'guarantee.invalid_manifest', 'Guarantee manifest must be an object.', 'manifest', sourcePath));
		return null;
	}
	const schemaVersion = stringValue(value.schemaVersion);
	if (schemaVersion !== TREESEED_GUARANTEE_SCHEMA_VERSION) diagnostics.push(diagnostic('error', 'guarantee.unsupported_schema_version', `Unsupported guarantee schema version "${schemaVersion}".`, 'schemaVersion', sourcePath));
	const id = stringValue(value.id);
	const type = stringValue(value.type);
	const subtype = stringValue(value.subtype);
	const journey = stringValue(value.journey);
	const ownerPackage = stringValue(value.ownerPackage);
	const surface = stringValue(value.surface) as TreeseedGuaranteeSurface;
	const summary = stringValue(value.summary);
	const status = stringValue(value.status) as TreeseedGuaranteeStatus;

	for (const [field, fieldValue] of Object.entries({ id, type, subtype, journey, ownerPackage, summary, status })) {
		if (!fieldValue) diagnostics.push(diagnostic('error', 'guarantee.missing_required_field', `Missing required field: ${field}.`, field, sourcePath));
	}
	if (id && !GUARANTEE_ID_PATTERN.test(id)) diagnostics.push(diagnostic('error', 'guarantee.invalid_id', `Invalid guarantee id "${id}".`, 'id', sourcePath));
	if (type && !TAXONOMY_PATTERN.test(type)) diagnostics.push(diagnostic('error', 'guarantee.invalid_type', `Guarantee type must be lowercase kebab-case: ${type}.`, 'type', sourcePath));
	if (subtype && !TAXONOMY_PATTERN.test(subtype)) diagnostics.push(diagnostic('error', 'guarantee.invalid_subtype', `Guarantee subtype must be lowercase kebab-case: ${subtype}.`, 'subtype', sourcePath));
	if (status && !KNOWN_STATUSES.has(status)) diagnostics.push(diagnostic('error', 'guarantee.invalid_status', `Unsupported guarantee status "${status}".`, 'status', sourcePath));
	if (surface && !KNOWN_SURFACES.has(surface)) diagnostics.push(diagnostic('error', 'guarantee.invalid_surface', `Unsupported guarantee surface "${surface}".`, 'surface', sourcePath));

	const dependencies = isRecord(value.dependencies) ? value.dependencies : {};
	const actors = isRecord(value.actors) ? value.actors : {};
	const devices = isRecord(value.devices) ? value.devices : {};
	const preconditions = isRecord(value.preconditions) ? value.preconditions : {};
	const evidence = isRecord(value.evidence) ? value.evidence : {};
	const gates = stringArray(value.gates) as TreeseedGuaranteeGate[];
	for (const gate of gates) {
		if (!KNOWN_GATES.has(gate)) diagnostics.push(diagnostic('error', 'guarantee.invalid_gate', `Unsupported guarantee gate "${gate}".`, 'gates', sourcePath));
	}
	const requiredDevices = stringArray(devices.required) as TreeseedGuaranteeDevice[];
	const optionalDevices = stringArray(devices.optional) as TreeseedGuaranteeDevice[];
	for (const device of [...requiredDevices, ...optionalDevices]) {
		if (!KNOWN_DEVICES.has(device)) diagnostics.push(diagnostic('error', 'guarantee.invalid_device', `Unsupported guarantee device "${device}".`, 'devices', sourcePath));
	}

	const manifest: TreeseedGuaranteeManifest = {
		schemaVersion: TREESEED_GUARANTEE_SCHEMA_VERSION,
		id,
		...(Number.isInteger(Number(value.journeyIndex)) ? { journeyIndex: Number(value.journeyIndex) } : {}),
		type,
		subtype,
		journey,
		ownerPackage,
		...(surface ? { surface } : {}),
		summary,
		status,
		...(parseRunContract(value.run) ? { run: parseRunContract(value.run) } : {}),
		dependencies: {
			journeys: numberArray(dependencies.journeys),
			guarantees: stringArray(dependencies.guarantees),
		},
		actors: {
			allowed: stringArray(actors.allowed),
			forbidden: stringArray(actors.forbidden),
		},
		devices: {
			required: requiredDevices,
			...(optionalDevices.length > 0 ? { optional: optionalDevices } : {}),
		},
		gates,
		preconditions: {
			fixtures: stringArray(preconditions.fixtures),
			notes: stringArray(preconditions.notes),
		},
		...(parseScene(value.scene) ? { scene: parseScene(value.scene) } : {}),
		...(parseContract(value.api) ? { api: parseContract(value.api) } : {}),
		...(parseContract(value.content) ? { content: parseContract(value.content) } : {}),
		...(parseContract(value.audit) ? { audit: parseContract(value.audit) } : {}),
		negativeCases: Array.isArray(value.negativeCases)
			? value.negativeCases.filter(isRecord).map((entry) => ({
					id: stringValue(entry.id),
					...(typeof entry.actor === 'string' ? { actor: entry.actor } : {}),
					verifierRefs: stringArray(entry.verifierRefs),
					notes: stringArray(entry.notes),
				}))
			: [],
		evidence: {
			required: stringArray(evidence.required),
			optional: stringArray(evidence.optional),
		},
		notes: stringArray(value.notes),
	};

	if (manifest.status === 'active') {
		const hasContract = Boolean(manifest.scene?.required || manifest.api?.required || manifest.content?.required || manifest.audit?.required);
		if (!hasContract) diagnostics.push(diagnostic('error', 'guarantee.active_missing_contract', 'Active guarantees must require a scene, API, content, or audit contract.', 'scene', sourcePath));
		if ((manifest.gates.includes('release') || manifest.gates.includes('security')) && manifest.evidence.required.length === 0) {
			diagnostics.push(diagnostic('error', 'guarantee.release_missing_evidence', 'Release/security guarantees must require evidence.', 'evidence.required', sourcePath));
		}
		if ((manifest.gates.includes('release') || manifest.gates.includes('security')) && allVerifierRefs(manifest).some((ref) => ref.startsWith('todo.'))) {
			diagnostics.push(diagnostic('error', 'guarantee.release_todo_verifier', 'Release/security guarantees cannot use todo verifier refs.', 'verifierRefs', sourcePath));
		}
	}
	if (manifest.status === 'active' && manifest.negativeCases?.length === 0) {
		diagnostics.push(diagnostic('warning', 'guarantee.no_negative_cases', 'Active guarantees should define at least one negative case.', 'negativeCases', sourcePath));
	}
	if (manifest.scene?.required && manifest.scene.manifest) {
		const scenePath = resolve(dirname(sourcePath), manifest.scene.manifest);
		if (!existsSync(scenePath) && manifest.status === 'active') diagnostics.push(diagnostic('error', 'guarantee.scene_missing', `Scene manifest does not exist: ${manifest.scene.manifest}.`, 'scene.manifest', sourcePath));
		if (!existsSync(scenePath) && manifest.status !== 'active') diagnostics.push(diagnostic('warning', 'guarantee.scene_missing_planned', `Planned guarantee scene does not exist yet: ${manifest.scene.manifest}.`, 'scene.manifest', sourcePath));
	}
	return diagnostics.some((entry) => entry.severity === 'error' && entry.sourcePath === sourcePath && entry.code !== 'guarantee.scene_missing_planned') ? manifest : manifest;
}

export function loadTreeseedGuaranteeManifest(input: { workspaceRoot: string; path: string }): TreeseedLoadedGuarantee {
	const sourcePath = resolve(input.path);
	const packageRoot = nearestPackageRoot(resolve(input.workspaceRoot), sourcePath);
	const ownerPackage = ownerPackageFromRoot(packageRoot);
	const diagnostics: TreeseedGuaranteeDiagnostic[] = [];
	const value = readYamlFile(sourcePath, diagnostics);
	const manifest = value ? parseGuaranteeManifest(value, diagnostics, sourcePath) : null;
	if (manifest) {
		if (manifest.ownerPackage !== ownerPackage) {
			diagnostics.push(diagnostic('error', 'guarantee.owner_package_mismatch', `Guarantee ownerPackage "${manifest.ownerPackage}" must match package "${ownerPackage}".`, 'ownerPackage', sourcePath));
		}
		validateTaxonomyPath({ workspaceRoot: input.workspaceRoot, sourcePath, manifest, diagnostics });
		if (sourcePath.includes(`${sep}packages${sep}treedx${sep}guarantees${sep}`)) {
			diagnostics.push(diagnostic('error', 'guarantee.treedx_product_semantics_forbidden', 'TreeSeed guarantee manifests must not live in packages/treedx.', 'sourcePath', sourcePath));
		}
	}
	return {
		sourcePath,
		relativePath: relative(resolve(input.workspaceRoot), sourcePath),
		packageRoot,
		ownerPackage,
		manifest,
		diagnostics,
	};
}

function parseVerifierRegistry(value: unknown, diagnostics: TreeseedGuaranteeDiagnostic[], sourcePath: string): TreeseedGuaranteeVerifierRegistry | null {
	if (!isRecord(value)) {
		diagnostics.push(diagnostic('error', 'guarantee_verifiers.invalid_manifest', 'Verifier registry must be an object.', 'manifest', sourcePath));
		return null;
	}
	const schemaVersion = stringValue(value.schemaVersion);
	const ownerPackage = stringValue(value.ownerPackage);
	if (schemaVersion !== TREESEED_GUARANTEE_VERIFIERS_SCHEMA_VERSION) diagnostics.push(diagnostic('error', 'guarantee_verifiers.unsupported_schema_version', `Unsupported verifier schema version "${schemaVersion}".`, 'schemaVersion', sourcePath));
	if (!ownerPackage) diagnostics.push(diagnostic('error', 'guarantee_verifiers.missing_owner_package', 'Verifier registry ownerPackage is required.', 'ownerPackage', sourcePath));
	const rawVerifiers = isRecord(value.verifiers) ? value.verifiers : {};
	const verifiers: Record<string, TreeseedGuaranteeVerifierDefinition> = {};
	for (const [id, entry] of Object.entries(rawVerifiers)) {
		if (!isRecord(entry)) {
			diagnostics.push(diagnostic('error', 'guarantee_verifiers.invalid_entry', `Verifier "${id}" must be an object.`, `verifiers.${id}`, sourcePath));
			continue;
		}
		const kind = stringValue(entry.kind) as TreeseedGuaranteeVerifierKind;
		verifiers[id] = {
			kind,
			...(typeof entry.ownerPackage === 'string' ? { ownerPackage: entry.ownerPackage } : {}),
			...(typeof entry.spec === 'string' ? { spec: entry.spec } : {}),
			...(typeof entry.caseId === 'string' ? { caseId: entry.caseId } : {}),
			...(typeof entry.command === 'string' ? { command: entry.command } : {}),
			...(Array.isArray(entry.args) ? { args: stringArray(entry.args) } : {}),
			...(typeof entry.testFile === 'string' ? { testFile: entry.testFile } : {}),
			...(typeof entry.testName === 'string' ? { testName: entry.testName } : {}),
			...(typeof entry.cwd === 'string' ? { cwd: entry.cwd } : {}),
			...(numberValue(entry.timeoutSeconds) ? { timeoutSeconds: numberValue(entry.timeoutSeconds) } : {}),
			...(Array.isArray(entry.evidence) ? { evidence: stringArray(entry.evidence) } : {}),
			...(typeof entry.description === 'string' ? { description: entry.description } : {}),
		};
		if (!verifiers[id].kind) diagnostics.push(diagnostic('error', 'guarantee_verifiers.missing_kind', `Verifier "${id}" is missing kind.`, `verifiers.${id}.kind`, sourcePath));
		if (verifiers[id].kind && !KNOWN_VERIFIER_KINDS.has(verifiers[id].kind)) diagnostics.push(diagnostic('error', 'guarantee_verifiers.invalid_kind', `Verifier "${id}" has unsupported kind "${verifiers[id].kind}".`, `verifiers.${id}.kind`, sourcePath));
	}
	return {
		schemaVersion: TREESEED_GUARANTEE_VERIFIERS_SCHEMA_VERSION,
		ownerPackage,
		verifiers,
	};
}

function loadVerifierRegistry(workspaceRoot: string, path: string): TreeseedLoadedGuaranteeVerifierRegistry {
	const sourcePath = resolve(path);
	const packageRoot = nearestPackageRoot(workspaceRoot, sourcePath);
	const ownerPackage = ownerPackageFromRoot(packageRoot);
	const diagnostics: TreeseedGuaranteeDiagnostic[] = [];
	const value = readYamlFile(sourcePath, diagnostics);
	const registry = value ? parseVerifierRegistry(value, diagnostics, sourcePath) : null;
	if (registry && registry.ownerPackage !== ownerPackage) {
		diagnostics.push(diagnostic('error', 'guarantee_verifiers.owner_package_mismatch', `Verifier ownerPackage "${registry.ownerPackage}" must match package "${ownerPackage}".`, 'ownerPackage', sourcePath));
	}
	return { sourcePath, ownerPackage, registry, diagnostics };
}

export function loadTreeseedGuaranteeVerifierRegistry(input: { workspaceRoot: string; path: string }): TreeseedLoadedGuaranteeVerifierRegistry {
	return loadVerifierRegistry(resolve(input.workspaceRoot), input.path);
}

export function discoverTreeseedGuarantees(input: { workspaceRoot: string; filter?: TreeseedGuaranteeFilter } = { workspaceRoot: process.cwd() }): TreeseedGuaranteeRegistryReport {
	const workspaceRoot = resolve(input.workspaceRoot);
	const guaranteePaths = walkFiles(workspaceRoot, (filePath) => filePath.endsWith('.guarantee.yaml'));
	const verifierPaths = walkFiles(workspaceRoot, (filePath) => filePath.endsWith('.verifiers.yaml'));
	const guarantees = guaranteePaths.map((path) => loadTreeseedGuaranteeManifest({ workspaceRoot, path }));
	const verifierRegistries = verifierPaths.map((path) => loadVerifierRegistry(workspaceRoot, path));
	return validateTreeseedGuaranteeRegistry({ workspaceRoot, guarantees, verifierRegistries, filter: input.filter });
}

export function validateTreeseedGuarantee(input: { workspaceRoot: string; path: string }) {
	return loadTreeseedGuaranteeManifest(input);
}

function allVerifierRefs(manifest: TreeseedGuaranteeManifest) {
	return [
		...(manifest.api?.verifierRefs ?? []),
		...(manifest.content?.verifierRefs ?? []),
		...(manifest.audit?.verifierRefs ?? []),
		...(manifest.negativeCases ?? []).flatMap((entry) => entry.verifierRefs ?? []),
	];
}

function selectedByFilter(manifest: TreeseedGuaranteeManifest, filter: TreeseedGuaranteeFilter = {}) {
	if (filter.gate && !manifest.gates.includes(filter.gate)) return false;
	if (filter.type && manifest.type !== filter.type) return false;
	if (filter.subtype && manifest.subtype !== filter.subtype) return false;
	if (filter.ownerPackage && manifest.ownerPackage !== filter.ownerPackage) return false;
	if (filter.status && manifest.status !== filter.status) return false;
	if (filter.ids && filter.ids.length > 0 && !filter.ids.includes(manifest.id)) return false;
	if (filter.journeyIndexes && filter.journeyIndexes.length > 0 && (!manifest.journeyIndex || !filter.journeyIndexes.includes(manifest.journeyIndex))) return false;
	return true;
}

function validateFilter(filter: TreeseedGuaranteeFilter | undefined, diagnostics: TreeseedGuaranteeDiagnostic[]) {
	for (const field of ['type', 'subtype'] as const) {
		const value = filter?.[field];
		if (value && !TAXONOMY_PATTERN.test(value)) diagnostics.push(diagnostic('error', `guarantee_filter.invalid_${field}`, `Filter ${field} must be lowercase kebab-case. Try "${normalizeTreeseedGuaranteeTaxonomy(value)}".`, field));
	}
}

export function filterTreeseedGuarantees(input: { guarantees: TreeseedLoadedGuarantee[]; filter?: TreeseedGuaranteeFilter; includeDependencies?: boolean }) {
	const valid = input.guarantees.filter((entry): entry is TreeseedLoadedGuarantee & { manifest: TreeseedGuaranteeManifest } => Boolean(entry.manifest));
	const byId = new Map(valid.map((entry) => [entry.manifest.id, entry]));
	const selected = new Map<string, TreeseedLoadedGuarantee & { manifest: TreeseedGuaranteeManifest }>();
	for (const entry of valid) {
		if (selectedByFilter(entry.manifest, input.filter)) selected.set(entry.manifest.id, entry);
	}
	if (input.includeDependencies !== false) {
		const visit = (id: string) => {
			const entry = byId.get(id);
			if (!entry) return;
			for (const dep of entry.manifest.dependencies.guarantees ?? []) {
				const depEntry = byId.get(dep);
				if (depEntry && !selected.has(dep)) {
					selected.set(dep, depEntry);
					visit(dep);
				}
			}
		};
		for (const id of [...selected.keys()]) visit(id);
	}
	return [...selected.values()].sort((a, b) => (a.manifest.journeyIndex ?? 99999) - (b.manifest.journeyIndex ?? 99999) || a.manifest.id.localeCompare(b.manifest.id));
}

export function validateTreeseedGuaranteeRegistry(input: {
	workspaceRoot: string;
	guarantees: TreeseedLoadedGuarantee[];
	verifierRegistries?: TreeseedLoadedGuaranteeVerifierRegistry[];
	filter?: TreeseedGuaranteeFilter;
}): TreeseedGuaranteeRegistryReport {
	const diagnostics: TreeseedGuaranteeDiagnostic[] = [
		...input.guarantees.flatMap((entry) => entry.diagnostics),
		...(input.verifierRegistries ?? []).flatMap((entry) => entry.diagnostics),
	];
	validateFilter(input.filter, diagnostics);
	const valid = input.guarantees.filter((entry): entry is TreeseedLoadedGuarantee & { manifest: TreeseedGuaranteeManifest } => Boolean(entry.manifest));
	const ids = new Map<string, TreeseedLoadedGuarantee & { manifest: TreeseedGuaranteeManifest }>();
	const journeyIndexes = new Map<number, TreeseedLoadedGuarantee & { manifest: TreeseedGuaranteeManifest }>();
	for (const entry of valid) {
		const existing = ids.get(entry.manifest.id);
		if (existing) diagnostics.push(diagnostic('error', 'guarantee.duplicate_id', `Duplicate guarantee id "${entry.manifest.id}" also appears at ${existing.relativePath}.`, 'id', entry.sourcePath));
		ids.set(entry.manifest.id, entry);
		if (entry.manifest.journeyIndex) {
			const existingIndex = journeyIndexes.get(entry.manifest.journeyIndex);
			if (existingIndex) diagnostics.push(diagnostic('error', 'guarantee.duplicate_journey_index', `Duplicate journey index ${entry.manifest.journeyIndex} also appears at ${existingIndex.relativePath}.`, 'journeyIndex', entry.sourcePath));
			journeyIndexes.set(entry.manifest.journeyIndex, entry);
		}
	}
	for (const entry of valid) {
		for (const dep of entry.manifest.dependencies.guarantees ?? []) {
			if (!ids.has(dep)) diagnostics.push(diagnostic('error', 'guarantee.missing_dependency', `Missing guarantee dependency "${dep}".`, 'dependencies.guarantees', entry.sourcePath));
		}
		for (const dep of entry.manifest.dependencies.journeys ?? []) {
			if (!journeyIndexes.has(dep)) diagnostics.push(diagnostic('error', 'guarantee.missing_journey_dependency', `Missing journey dependency "${dep}".`, 'dependencies.journeys', entry.sourcePath));
			if (entry.manifest.journeyIndex && dep >= entry.manifest.journeyIndex) diagnostics.push(diagnostic('error', 'guarantee.forward_journey_dependency', `Journey dependency ${dep} must be lower than ${entry.manifest.journeyIndex}.`, 'dependencies.journeys', entry.sourcePath));
		}
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string, chain: string[]) => {
		if (visited.has(id)) return;
		if (visiting.has(id)) {
			diagnostics.push(diagnostic('error', 'guarantee.dependency_cycle', `Guarantee dependency cycle: ${[...chain, id].join(' -> ')}.`, 'dependencies.guarantees', ids.get(id)?.sourcePath));
			return;
		}
		visiting.add(id);
		for (const dep of ids.get(id)?.manifest.dependencies.guarantees ?? []) visit(dep, [...chain, id]);
		visiting.delete(id);
		visited.add(id);
	};
	for (const id of ids.keys()) visit(id, []);

	const verifierIds = new Set((input.verifierRegistries ?? []).flatMap((entry) => Object.keys(entry.registry?.verifiers ?? {})));
	const verifierKinds = new Map((input.verifierRegistries ?? []).flatMap((registry) =>
		Object.entries(registry.registry?.verifiers ?? {}).map(([id, definition]) => [id, definition.kind] as const)
	));
	for (const entry of valid) {
		for (const ref of allVerifierRefs(entry.manifest)) {
			if (ref.startsWith('todo.')) {
				if (entry.manifest.status === 'active') diagnostics.push(diagnostic('error', 'guarantee.todo_verifier_active', `Active guarantee cannot use placeholder verifier ref "${ref}".`, 'verifierRefs', entry.sourcePath));
				continue;
			}
			if (!verifierIds.has(ref)) {
				const severity = entry.manifest.status === 'active' ? 'error' : 'warning';
				diagnostics.push(diagnostic(severity, 'guarantee.missing_verifier_ref', `Verifier ref "${ref}" is not defined.`, 'verifierRefs', entry.sourcePath));
			}
			if ((entry.manifest.gates.includes('release') || entry.manifest.gates.includes('security')) && verifierKinds.get(ref) === 'manualEvidence') {
				diagnostics.push(diagnostic('error', 'guarantee.release_manual_evidence', `Release/security guarantee cannot depend on manual evidence verifier "${ref}".`, 'verifierRefs', entry.sourcePath));
			}
		}
	}

	const selected = input.filter ? filterTreeseedGuarantees({ guarantees: input.guarantees, filter: input.filter }).length : undefined;
	const errors = diagnostics.filter((entry) => entry.severity === 'error').length;
	const warnings = diagnostics.filter((entry) => entry.severity === 'warning').length;
	return {
		ok: errors === 0,
		workspaceRoot: resolve(input.workspaceRoot),
		guarantees: input.guarantees,
		verifierRegistries: input.verifierRegistries ?? [],
		diagnostics,
		counts: {
			total: input.guarantees.length,
			valid: valid.length,
			...(selected !== undefined ? { selected } : {}),
			errors,
			warnings,
		},
	};
}

function refs(contract: TreeseedGuaranteeVerifierContract | undefined) {
	return contract?.verifierRefs ?? [];
}

export function planTreeseedGuarantees(input: { workspaceRoot: string; filter?: TreeseedGuaranteeFilter; environment?: string; includeDependencies?: boolean }): TreeseedGuaranteePlanReport {
	const registry = discoverTreeseedGuarantees({ workspaceRoot: input.workspaceRoot, filter: input.filter });
	const selectedWithoutDeps = filterTreeseedGuarantees({ guarantees: registry.guarantees, filter: input.filter, includeDependencies: false });
	const selectedIds = new Set(selectedWithoutDeps.map((entry) => entry.manifest.id));
	const entries = filterTreeseedGuarantees({ guarantees: registry.guarantees, filter: input.filter, includeDependencies: input.includeDependencies !== false })
		.map((entry): TreeseedGuaranteePlanEntry => ({
			id: entry.manifest.id,
			...(entry.manifest.journeyIndex ? { journeyIndex: entry.manifest.journeyIndex } : {}),
			type: entry.manifest.type,
			subtype: entry.manifest.subtype,
			journey: entry.manifest.journey,
			ownerPackage: entry.manifest.ownerPackage,
			...(entry.manifest.surface ? { surface: entry.manifest.surface } : {}),
			status: entry.manifest.status,
			gates: entry.manifest.gates,
			sourcePath: entry.relativePath,
			selected: selectedIds.has(entry.manifest.id),
			dependency: !selectedIds.has(entry.manifest.id),
			...(entry.manifest.scene?.manifest ? { sceneManifest: entry.manifest.scene.manifest } : {}),
			apiVerifierRefs: refs(entry.manifest.api),
			contentVerifierRefs: refs(entry.manifest.content),
			auditVerifierRefs: refs(entry.manifest.audit),
			evidenceRequired: entry.manifest.evidence.required,
		}));
	const errors = registry.diagnostics.filter((entry) => entry.severity === 'error').length;
	const warnings = registry.diagnostics.filter((entry) => entry.severity === 'warning').length;
	return {
		ok: registry.ok,
		workspaceRoot: resolve(input.workspaceRoot),
		filter: input.filter ?? {},
		environment: input.environment ?? 'local',
		entries,
		diagnostics: registry.diagnostics,
		counts: {
			total: registry.counts.total,
			selected: selectedWithoutDeps.length,
			withDependencies: entries.length,
			errors,
			warnings,
		},
	};
}

function csvEscape(value: unknown) {
	const text = Array.isArray(value) ? value.join('; ') : String(value ?? '');
	return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

export function exportTreeseedGuaranteesCsv(input: { guarantees: TreeseedLoadedGuarantee[]; filter?: TreeseedGuaranteeFilter }) {
	const rows = filterTreeseedGuarantees({ guarantees: input.guarantees, filter: input.filter, includeDependencies: false });
	const header = [
		'Guarantee ID',
		'Journey Index',
		'Type',
		'Subtype',
		'Journey',
		'Owner Package',
		'Surface',
		'Status',
		'Dependencies',
		'Actor Roles',
		'Forbidden Roles',
		'Device Coverage',
		'Preconditions',
		'Scene Manifest',
		'API Verifier Refs',
		'Content Verifier Refs',
		'Audit Verifier Refs',
		'Negative Cases',
		'Release Gates',
		'Evidence Required',
		'Notes',
		'Source Path',
	];
	const body = rows.map((entry) => [
		entry.manifest.id,
		entry.manifest.journeyIndex ?? '',
		entry.manifest.type,
		entry.manifest.subtype,
		entry.manifest.journey,
		entry.manifest.ownerPackage,
		entry.manifest.surface ?? '',
		entry.manifest.status,
		[...(entry.manifest.dependencies.guarantees ?? []), ...(entry.manifest.dependencies.journeys ?? []).map((id) => `journey:${id}`)],
		entry.manifest.actors.allowed,
		entry.manifest.actors.forbidden,
		[...entry.manifest.devices.required, ...(entry.manifest.devices.optional ?? [])],
		[...(entry.manifest.preconditions.fixtures ?? []), ...(entry.manifest.preconditions.notes ?? [])],
		entry.manifest.scene?.manifest ?? '',
		entry.manifest.api?.verifierRefs ?? [],
		entry.manifest.content?.verifierRefs ?? [],
		entry.manifest.audit?.verifierRefs ?? [],
		(entry.manifest.negativeCases ?? []).map((negativeCase) => negativeCase.id),
		entry.manifest.gates,
		entry.manifest.evidence.required,
		entry.manifest.notes ?? [],
		entry.relativePath,
	]);
	return [header, ...body].map((row) => row.map(csvEscape).join(',')).join('\n') + '\n';
}

export function exportTreeseedGuaranteesJson(input: { registry: TreeseedGuaranteeRegistryReport; filter?: TreeseedGuaranteeFilter }) {
	return {
		schemaVersion: 'treeseed.guarantees.export/v1',
		generatedAt: new Date().toISOString(),
		workspaceRoot: input.registry.workspaceRoot,
		guarantees: filterTreeseedGuarantees({ guarantees: input.registry.guarantees, filter: input.filter, includeDependencies: false }).map((entry) => ({
			sourcePath: entry.relativePath,
			...entry.manifest,
		})),
	};
}

export function exportTreeseedGuaranteesMarkdown(input: { registry: TreeseedGuaranteeRegistryReport; filter?: TreeseedGuaranteeFilter }) {
	const rows = filterTreeseedGuarantees({ guarantees: input.registry.guarantees, filter: input.filter, includeDependencies: false });
	return [
		'# TreeSeed Guarantees',
		'',
		`Generated from ${rows.length} guarantee manifests.`,
		'',
		'| ID | Type | Subtype | Journey | Status | Gates |',
		'| --- | --- | --- | --- | --- | --- |',
		...rows.map((entry) => `| ${entry.manifest.id} | ${entry.manifest.type} | ${entry.manifest.subtype} | ${entry.manifest.journey.replace(/\|/gu, '\\|')} | ${entry.manifest.status} | ${entry.manifest.gates.join(', ')} |`),
		'',
	].join('\n');
}

export function writeTreeseedGuaranteesExport(input: { workspaceRoot: string; format: 'csv' | 'json' | 'markdown'; output: string; filter?: TreeseedGuaranteeFilter }) {
	const registry = discoverTreeseedGuarantees({ workspaceRoot: input.workspaceRoot, filter: input.filter });
	const outputPath = resolve(input.workspaceRoot, input.output);
	mkdirSync(dirname(outputPath), { recursive: true });
	const content = input.format === 'csv'
		? exportTreeseedGuaranteesCsv({ guarantees: registry.guarantees, filter: input.filter })
		: input.format === 'json'
			? `${JSON.stringify(exportTreeseedGuaranteesJson({ registry, filter: input.filter }), null, 2)}\n`
			: exportTreeseedGuaranteesMarkdown({ registry, filter: input.filter });
	writeFileSync(outputPath, content, 'utf8');
	return { ok: registry.ok, outputPath, registry };
}

function verifierDefinitionsByRef(registries: TreeseedLoadedGuaranteeVerifierRegistry[]) {
	const definitions = new Map<string, TreeseedGuaranteeVerifierResolution>();
	for (const registry of registries) {
		for (const [ref, definition] of Object.entries(registry.registry?.verifiers ?? {})) {
			definitions.set(ref, {
				ref,
				resolved: true,
				sourcePath: registry.sourcePath,
				ownerPackage: definition.ownerPackage ?? registry.ownerPackage,
				definition: { ownerPackage: definition.ownerPackage ?? registry.ownerPackage, ...definition },
			});
		}
	}
	return definitions;
}

export function resolveTreeseedGuaranteeVerifierRefs(input: {
	refs: string[];
	verifierRegistries: TreeseedLoadedGuaranteeVerifierRegistry[];
	status?: TreeseedGuaranteeStatus;
	sourcePath?: string;
}): TreeseedGuaranteeVerifierResolutionReport {
	const diagnostics: TreeseedGuaranteeDiagnostic[] = [];
	const definitions = verifierDefinitionsByRef(input.verifierRegistries);
	const resolutions = [...new Set(input.refs)].map((ref) => {
		if (ref.startsWith('todo.')) {
			const severity = input.status === 'active' ? 'error' : 'warning';
			diagnostics.push(diagnostic(severity, 'guarantee.todo_verifier_ref', `Verifier ref "${ref}" is a placeholder.`, 'verifierRefs', input.sourcePath));
			return { ref, resolved: false };
		}
		const resolved = definitions.get(ref);
		if (resolved) return resolved;
		const severity = input.status === 'active' ? 'error' : 'warning';
		diagnostics.push(diagnostic(severity, 'guarantee.missing_verifier_ref', `Verifier ref "${ref}" is not defined.`, 'verifierRefs', input.sourcePath));
		return { ref, resolved: false };
	});
	return { ok: diagnostics.every((entry) => entry.severity !== 'error'), resolutions, diagnostics };
}

function packageWorkspaceForOwner(ownerPackage: string) {
	if (ownerPackage === '@treeseed/market') return '.';
	const name = ownerPackage.replace(/^@treeseed\//u, '');
	return `packages/${name}`;
}

function relativeEvidencePath(workspaceRoot: string, path: string) {
	return relative(resolve(workspaceRoot), resolve(path)).replace(/\\/gu, '/');
}

async function writeCommandEvidence(input: {
	workspaceRoot: string;
	outputRoot: string;
	ref: string;
	command: string;
	args: string[];
	cwd?: string;
	timeoutSeconds?: number;
	env?: Record<string, string | undefined>;
}) {
	const safeRef = slugifyTreeseedGuaranteeJourney(input.ref);
	const evidencePath = resolve(input.outputRoot, 'evidence', `${safeRef}.json`);
	mkdirSync(dirname(evidencePath), { recursive: true });
	const startedAt = new Date().toISOString();
	try {
		const result = await execFileAsync(input.command, input.args, {
			cwd: input.cwd ? resolve(input.workspaceRoot, input.cwd) : resolve(input.workspaceRoot),
			env: input.env ? { ...process.env, ...input.env } : process.env,
			timeout: Math.max(1, input.timeoutSeconds ?? 300) * 1000,
			maxBuffer: 1024 * 1024 * 20,
		});
		const completedAt = new Date().toISOString();
		writeFileSync(evidencePath, `${JSON.stringify({
			ref: input.ref,
			command: input.command,
			args: input.args,
			cwd: input.cwd ?? '.',
			startedAt,
			completedAt,
			exitCode: 0,
			env: evidenceEnvSummary(input.env),
			stdout: result.stdout,
			stderr: result.stderr,
		}, null, 2)}\n`, 'utf8');
		return {
			status: 'passed' as TreeseedGuaranteeRunStatus,
			summary: `${input.ref} passed.`,
			evidence: [relativeEvidencePath(input.workspaceRoot, evidencePath)],
		};
	} catch (error) {
		const completedAt = new Date().toISOString();
		const commandError = error as Error & { stdout?: string; stderr?: string; code?: number | string };
		writeFileSync(evidencePath, `${JSON.stringify({
			ref: input.ref,
			command: input.command,
			args: input.args,
			cwd: input.cwd ?? '.',
			startedAt,
			completedAt,
			exitCode: commandError.code ?? 1,
			env: evidenceEnvSummary(input.env),
			stdout: commandError.stdout ?? '',
			stderr: commandError.stderr ?? '',
			error: commandError.message,
		}, null, 2)}\n`, 'utf8');
		return {
			status: 'failed' as TreeseedGuaranteeRunStatus,
			summary: `${input.ref} failed.`,
			evidence: [relativeEvidencePath(input.workspaceRoot, evidencePath)],
			diagnostics: [diagnostic('error', 'guarantee.verifier_failed', commandError.message, input.ref)],
		};
	}
}

function evidenceEnvSummary(env?: Record<string, string | undefined>) {
	if (!env) return undefined;
	return Object.fromEntries(Object.entries(env).map(([key, value]) => [
		key,
		/SECRET|TOKEN|KEY|PASSWORD/iu.test(key) && value ? '<redacted>' : value,
	]));
}

function apiAcceptanceEnvironment(environment: string) {
	const baseUrl = apiAcceptanceBaseUrl(environment);
	const serviceId = process.env.TREESEED_ACCEPTANCE_SERVICE_ID
		?? process.env.TREESEED_API_WEB_SERVICE_ID
		?? process.env.TREESEED_WEB_SERVICE_ID
		?? (environment === 'local' ? 'web' : undefined);
	const serviceSecret = process.env.TREESEED_ACCEPTANCE_SERVICE_SECRET
		?? process.env.TREESEED_API_WEB_SERVICE_SECRET
		?? process.env.TREESEED_WEB_SERVICE_SECRET
		?? (environment === 'local' ? 'treeseed-web-service-dev-secret' : undefined);
	return {
		TREESEED_ACCEPTANCE_ENVIRONMENT: environment,
		TREESEED_API_BASE_URL: baseUrl,
		TREESEED_ACCEPTANCE_SERVICE_ID: serviceId,
		TREESEED_ACCEPTANCE_SERVICE_SECRET: serviceSecret,
	};
}

function apiAcceptanceBaseUrl(environment: string) {
	if (process.env.TREESEED_API_BASE_URL?.trim()) {
		const configured = process.env.TREESEED_API_BASE_URL.trim().replace(/\/+$/u, '');
		if (environment !== 'local' && isLoopbackUrl(configured)) {
			throw new Error(`API guarantee environment ${environment} must target a live hosted API URL, not ${configured}.`);
		}
		return configured;
	}
	if (environment === 'staging') return 'https://api.preview.treeseed.dev';
	if (environment === 'prod') return 'https://api.treeseed.dev';
	return 'http://127.0.0.1:3000';
}

function isLoopbackUrl(value: string) {
	try {
		const url = new URL(value);
		return ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(url.hostname);
	} catch {
		return false;
	}
}

async function defaultTreeseedGuaranteeVerifierExecutor(input: TreeseedGuaranteeVerifierExecutionInput): Promise<TreeseedGuaranteeVerifierExecutionResult> {
	const definition = input.definition;
	const ownerPackage = definition.ownerPackage ?? input.guarantee.manifest.ownerPackage;
	const workspace = packageWorkspaceForOwner(ownerPackage);
	if (definition.kind === 'todo') {
		return {
			status: 'blocked',
			summary: `${input.ref} is a todo verifier.`,
			diagnostics: [diagnostic('error', 'guarantee.todo_verifier_execution', `Verifier ref "${input.ref}" is not executable.`, input.ref, input.guarantee.sourcePath)],
		};
	}
	if (definition.kind === 'manualEvidence') {
		return { status: 'skipped', summary: `${input.ref} requires manual evidence.`, evidence: definition.evidence ?? [] };
	}
	if (definition.kind === 'scene') {
		return { status: 'passed', summary: `${input.ref} is covered by the guarantee scene step.`, evidence: definition.evidence ?? [] };
	}
	if (definition.kind === 'apiAcceptanceCase') {
		if (!definition.caseId) {
			return { status: 'blocked', summary: `${input.ref} missing caseId.`, diagnostics: [diagnostic('error', 'guarantee.api_verifier_missing_case_id', `API verifier "${input.ref}" is missing caseId.`, input.ref, input.guarantee.sourcePath)] };
		}
		return writeCommandEvidence({
			workspaceRoot: input.workspaceRoot,
			outputRoot: input.outputRoot,
			ref: input.ref,
			command: 'npm',
			args: ['-w', 'packages/api', 'run', 'test:acceptance', '--', '--environment', input.environment, '--base-url', apiAcceptanceBaseUrl(input.environment), '--case', definition.caseId, '--json'],
			timeoutSeconds: definition.timeoutSeconds,
			env: apiAcceptanceEnvironment(input.environment),
		});
	}
	if (definition.kind === 'vitestCase') {
		if (!definition.testFile) {
			return { status: 'blocked', summary: `${input.ref} missing testFile.`, diagnostics: [diagnostic('error', 'guarantee.vitest_verifier_missing_test_file', `Vitest verifier "${input.ref}" is missing testFile.`, input.ref, input.guarantee.sourcePath)] };
		}
		return writeCommandEvidence({
			workspaceRoot: input.workspaceRoot,
			outputRoot: input.outputRoot,
			ref: input.ref,
			command: 'npm',
			args: ['-w', workspace, 'exec', '--', 'vitest', 'run', '--config', './vitest.config.ts', definition.testFile, ...(definition.testName ? ['-t', definition.testName] : [])],
			timeoutSeconds: definition.timeoutSeconds,
		});
	}
	if (definition.kind === 'packageScript') {
		if (!definition.command) {
			return { status: 'blocked', summary: `${input.ref} missing command.`, diagnostics: [diagnostic('error', 'guarantee.package_script_missing_command', `Package script verifier "${input.ref}" is missing command.`, input.ref, input.guarantee.sourcePath)] };
		}
		return writeCommandEvidence({
			workspaceRoot: input.workspaceRoot,
			outputRoot: input.outputRoot,
			ref: input.ref,
			command: 'npm',
			args: ['-w', workspace, 'run', definition.command, '--', ...(definition.args ?? [])],
			timeoutSeconds: definition.timeoutSeconds,
		});
	}
	if (definition.kind === 'nodeScript') {
		if (!definition.command) {
			return { status: 'blocked', summary: `${input.ref} missing command.`, diagnostics: [diagnostic('error', 'guarantee.node_script_missing_command', `Node script verifier "${input.ref}" is missing command.`, input.ref, input.guarantee.sourcePath)] };
		}
		return writeCommandEvidence({
			workspaceRoot: input.workspaceRoot,
			outputRoot: input.outputRoot,
			ref: input.ref,
			command: 'node',
			args: ['--import', 'tsx', definition.command, ...(definition.args ?? [])],
			cwd: definition.cwd,
			timeoutSeconds: definition.timeoutSeconds,
		});
	}
	return {
		status: 'blocked',
		summary: `${input.ref} has unsupported verifier kind.`,
		diagnostics: [diagnostic('error', 'guarantee.unsupported_verifier_kind', `Unsupported verifier kind "${definition.kind}".`, input.ref, input.guarantee.sourcePath)],
	};
}

async function defaultTreeseedGuaranteeSceneExecutor(input: TreeseedGuaranteeSceneExecutionInput): Promise<TreeseedGuaranteeVerifierExecutionResult> {
	try {
		const scenes = await import('../scenes/index.ts');
		const devices = input.guarantee.manifest.devices.required;
		if (devices.length > 1 && typeof scenes.runTreeseedSceneDeviceMatrix === 'function') {
			const report = await scenes.runTreeseedSceneDeviceMatrix({
				projectRoot: input.workspaceRoot,
				scene: input.scenePath,
				environment: input.environment,
				record: input.record,
				artifactMode: input.artifactMode,
				mode: 'acceptance',
				devices,
			});
			return {
				status: report.ok ? 'passed' : 'failed',
				summary: report.ok ? 'Scene device matrix passed.' : 'Scene device matrix failed.',
				evidence: [report.matrixPath, ...(report.runReports ?? []).map((entry: { artifacts?: { runRoot?: string } }) => entry.artifacts?.runRoot)].filter(Boolean).map((entry: string) => relativeEvidencePath(input.workspaceRoot, entry)),
				diagnostics: report.diagnostics ?? [],
			};
		}
		const report = await scenes.runTreeseedScene({
			projectRoot: input.workspaceRoot,
			scene: input.scenePath,
			environment: input.environment,
			device: input.device ?? devices[0],
			record: input.record,
			artifactMode: input.artifactMode,
			mode: 'acceptance',
		});
		return {
			status: report.ok ? 'passed' : 'failed',
			summary: report.ok ? 'Scene passed.' : 'Scene failed.',
			evidence: [report.artifacts?.runRoot, report.playwrightTracePath].filter(Boolean).map((entry: string) => relativeEvidencePath(input.workspaceRoot, entry)),
			diagnostics: report.diagnostics ?? [],
		};
	} catch (error) {
		return {
			status: 'failed',
			summary: error instanceof Error ? error.message : String(error),
			diagnostics: [diagnostic('error', 'guarantee.scene_execution_failed', error instanceof Error ? error.message : String(error), 'scene', input.guarantee.sourcePath)],
		};
	}
}

function markdownRunReport(report: TreeseedGuaranteeRunReport) {
	return [
		'# TreeSeed Guarantee Run',
		'',
		`Run: ${report.runId}`,
		`Environment: ${report.environment}`,
		`Started: ${report.startedAt}`,
		`Completed: ${report.completedAt}`,
		'',
		`Passed: ${report.counts.passed}`,
		`Failed: ${report.counts.failed}`,
		`Skipped: ${report.counts.skipped}`,
		`Blocked: ${report.counts.blocked}`,
		`Release blocking failures: ${report.counts.releaseBlockingFailures}`,
		'',
		'| Guarantee | Status | Steps |',
		'| --- | --- | --- |',
		...report.results.map((entry) => `| ${entry.id} | ${entry.status} | ${entry.steps.map((step) => `${step.id}:${step.status}`).join('<br>')} |`),
		'',
	].join('\n');
}

export function writeTreeseedGuaranteeRunReport(input: { report: TreeseedGuaranteeRunReport; registry?: TreeseedGuaranteeRegistryReport }): TreeseedGuaranteeReportWriteResult {
	const diagnostics: TreeseedGuaranteeDiagnostic[] = [];
	const outputRoot = resolve(input.report.outputRoot);
	try {
		mkdirSync(outputRoot, { recursive: true });
		const planPath = resolve(outputRoot, 'plan.json');
		const reportPath = resolve(outputRoot, 'report.json');
		const markdownPath = resolve(outputRoot, 'report.md');
		const csvPath = resolve(outputRoot, 'generated.csv');
		writeFileSync(planPath, `${JSON.stringify(input.report.plan, null, 2)}\n`, 'utf8');
		writeFileSync(reportPath, `${JSON.stringify(input.report, null, 2)}\n`, 'utf8');
		writeFileSync(markdownPath, markdownRunReport(input.report), 'utf8');
		if (input.registry) writeFileSync(csvPath, exportTreeseedGuaranteesCsv({ guarantees: input.registry.guarantees, filter: input.report.filter }), 'utf8');
		else writeFileSync(csvPath, '', 'utf8');
		return { ok: true, outputRoot, planPath, reportPath, markdownPath, csvPath, diagnostics };
	} catch (error) {
		diagnostics.push(diagnostic('error', 'guarantee.report_write_failed', error instanceof Error ? error.message : String(error), 'outputRoot', outputRoot));
		return {
			ok: false,
			outputRoot,
			planPath: resolve(outputRoot, 'plan.json'),
			reportPath: resolve(outputRoot, 'report.json'),
			markdownPath: resolve(outputRoot, 'report.md'),
			csvPath: resolve(outputRoot, 'generated.csv'),
			diagnostics,
		};
	}
}

function runIdFor(now: Date) {
	return now.toISOString().replace(/[:.]/gu, '-');
}

function releaseBlocking(manifest: TreeseedGuaranteeManifest) {
	return manifest.run?.requiredForRelease === true || manifest.gates.includes('release') || manifest.gates.includes('security') || manifest.gates.includes('migration');
}

async function runGuaranteeSteps(input: {
	workspaceRoot: string;
	environment: string;
	runId: string;
	outputRoot: string;
	guarantee: TreeseedLoadedGuarantee & { manifest: TreeseedGuaranteeManifest };
	selected: boolean;
	dependency: boolean;
	resolutions: Map<string, TreeseedGuaranteeVerifierResolution>;
	sceneExecutor: TreeseedGuaranteeSceneExecutor;
	verifierExecutor: TreeseedGuaranteeVerifierExecutor;
	verifierCache: Map<string, TreeseedGuaranteeVerifierExecutionResult>;
	record?: boolean;
	sceneArtifacts?: 'full' | 'screenshots';
	device?: string;
}) {
	const startedAt = new Date().toISOString();
	const steps: TreeseedGuaranteeRunStep[] = [];
	const diagnostics: TreeseedGuaranteeDiagnostic[] = [];
	const evidence: string[] = [];
	const addStep = async (step: Omit<TreeseedGuaranteeRunStep, 'startedAt' | 'completedAt'>, run: () => Promise<TreeseedGuaranteeVerifierExecutionResult>) => {
		const stepStartedAt = new Date().toISOString();
		const result = await run();
		const completedAt = new Date().toISOString();
		const nextStep: TreeseedGuaranteeRunStep = {
			...step,
			status: result.status,
			summary: result.summary ?? step.summary,
			evidence: result.evidence ?? step.evidence ?? [],
			diagnostics: result.diagnostics ?? step.diagnostics ?? [],
			startedAt: stepStartedAt,
			completedAt,
		};
		steps.push(nextStep);
		evidence.push(...(nextStep.evidence ?? []));
		diagnostics.push(...(nextStep.diagnostics ?? []));
	};
	const scene = input.guarantee.manifest.scene;
	if (scene?.required && scene.manifest) {
		const scenePath = resolve(dirname(input.guarantee.sourcePath), scene.manifest);
		await addStep({ id: 'scene', kind: 'scene', status: 'blocked' }, () => input.sceneExecutor({
			workspaceRoot: input.workspaceRoot,
			environment: input.environment,
			runId: input.runId,
			outputRoot: input.outputRoot,
			guarantee: input.guarantee,
			scenePath,
			record: input.record ?? false,
			artifactMode: input.sceneArtifacts,
			device: input.device,
		}));
	}
	const verifierGroups: Array<{ kind: TreeseedGuaranteeRunStep['kind']; refs: string[] }> = [
		{ kind: 'api', refs: input.guarantee.manifest.api?.verifierRefs ?? [] },
		{ kind: 'content', refs: input.guarantee.manifest.content?.verifierRefs ?? [] },
		{ kind: 'audit', refs: input.guarantee.manifest.audit?.verifierRefs ?? [] },
		{ kind: 'negative-case', refs: (input.guarantee.manifest.negativeCases ?? []).flatMap((entry) => entry.verifierRefs ?? []) },
	];
	for (const group of verifierGroups) {
		for (const ref of group.refs) {
			const resolution = input.resolutions.get(ref);
			if (!resolution?.definition) {
				const missing = diagnostic('error', 'guarantee.verifier_unresolved', `Verifier ref "${ref}" is not resolved.`, ref, input.guarantee.sourcePath);
				steps.push({ id: ref, kind: group.kind, ref, status: 'blocked', diagnostics: [missing], startedAt: new Date().toISOString(), completedAt: new Date().toISOString() });
				diagnostics.push(missing);
				continue;
			}
			const cacheKey = `${input.environment}:${group.kind}:${ref}`;
			await addStep({ id: ref, kind: group.kind, ref, status: 'blocked' }, async () => {
				const cached = input.verifierCache.get(cacheKey);
				if (cached) return { ...cached, summary: `${cached.summary ?? `${ref} passed.`} (cached)` };
				const result = await input.verifierExecutor({
				workspaceRoot: input.workspaceRoot,
				environment: input.environment,
				runId: input.runId,
				outputRoot: input.outputRoot,
				guarantee: input.guarantee,
				ref,
				definition: resolution.definition!,
				kind: group.kind,
				});
				input.verifierCache.set(cacheKey, result);
				return result;
			});
		}
	}
	const status: TreeseedGuaranteeRunStatus = steps.some((step) => step.status === 'failed')
		? 'failed'
		: steps.some((step) => step.status === 'blocked')
			? 'blocked'
			: steps.some((step) => step.status === 'skipped')
				? 'skipped'
				: 'passed';
	return {
		id: input.guarantee.manifest.id,
		...(input.guarantee.manifest.journeyIndex ? { journeyIndex: input.guarantee.manifest.journeyIndex } : {}),
		type: input.guarantee.manifest.type,
		subtype: input.guarantee.manifest.subtype,
		journey: input.guarantee.manifest.journey,
		ownerPackage: input.guarantee.manifest.ownerPackage,
		status,
		selected: input.selected,
		dependency: input.dependency,
		sourcePath: input.guarantee.relativePath,
		startedAt,
		completedAt: new Date().toISOString(),
		steps,
		evidence,
		diagnostics,
	};
}

export async function runTreeseedGuarantees(input: {
	workspaceRoot: string;
	filter?: TreeseedGuaranteeFilter;
	environment?: string;
	outputRoot?: string;
	includeDependencies?: boolean;
	includePlanned?: boolean;
	failOnSkippedReleaseGuarantees?: boolean;
	record?: boolean;
	sceneArtifacts?: 'full' | 'screenshots';
	device?: string;
	evidenceTarget?: 'local' | 'ci' | 'release';
	sceneExecutor?: TreeseedGuaranteeSceneExecutor;
	verifierExecutor?: TreeseedGuaranteeVerifierExecutor;
	now?: Date;
}): Promise<TreeseedGuaranteeRunReport> {
	const workspaceRoot = resolve(input.workspaceRoot);
	const environment = input.environment ?? 'local';
	const startedAtDate = input.now ?? new Date();
	const startedAt = startedAtDate.toISOString();
	const runId = runIdFor(startedAtDate);
	const outputRoot = resolve(workspaceRoot, input.outputRoot ?? (input.evidenceTarget === 'release'
		? `.treeseed/guarantees/release/${runId}`
		: `.treeseed/guarantees/runs/${runId}`));
	const filter = input.filter ?? {};
	const registry = discoverTreeseedGuarantees({ workspaceRoot, filter });
	const plan = planTreeseedGuarantees({ workspaceRoot, filter, environment, includeDependencies: input.includeDependencies });
	const diagnostics: TreeseedGuaranteeDiagnostic[] = [...registry.diagnostics, ...plan.diagnostics];
	const allResolutions = verifierDefinitionsByRef(registry.verifierRegistries);
	const verifierCache = new Map<string, TreeseedGuaranteeVerifierExecutionResult>();
	const selectedWithoutDeps = filterTreeseedGuarantees({ guarantees: registry.guarantees, filter, includeDependencies: false });
	const selectedIds = new Set(selectedWithoutDeps.map((entry) => entry.manifest.id));
	const runEntries = filterTreeseedGuarantees({ guarantees: registry.guarantees, filter, includeDependencies: input.includeDependencies !== false });
	const results: TreeseedGuaranteeRunResult[] = [];
	if (registry.ok && plan.ok) {
		for (const entry of runEntries) {
			if (entry.manifest.status !== 'active') {
				if (input.includePlanned) {
					const now = new Date().toISOString();
					results.push({
						id: entry.manifest.id,
						...(entry.manifest.journeyIndex ? { journeyIndex: entry.manifest.journeyIndex } : {}),
						type: entry.manifest.type,
						subtype: entry.manifest.subtype,
						journey: entry.manifest.journey,
						ownerPackage: entry.manifest.ownerPackage,
						status: 'skipped',
						selected: selectedIds.has(entry.manifest.id),
						dependency: !selectedIds.has(entry.manifest.id),
						sourcePath: entry.relativePath,
						startedAt: now,
						completedAt: now,
						steps: [{ id: 'status', kind: 'verifier', status: 'skipped', summary: `Guarantee is ${entry.manifest.status}.`, startedAt: now, completedAt: now }],
						evidence: [],
						diagnostics: [],
					});
				}
				continue;
			}
			const resolution = resolveTreeseedGuaranteeVerifierRefs({
				refs: allVerifierRefs(entry.manifest),
				verifierRegistries: registry.verifierRegistries,
				status: entry.manifest.status,
				sourcePath: entry.sourcePath,
			});
			diagnostics.push(...resolution.diagnostics);
			if (!resolution.ok) {
				const now = new Date().toISOString();
				results.push({
					id: entry.manifest.id,
					...(entry.manifest.journeyIndex ? { journeyIndex: entry.manifest.journeyIndex } : {}),
					type: entry.manifest.type,
					subtype: entry.manifest.subtype,
					journey: entry.manifest.journey,
					ownerPackage: entry.manifest.ownerPackage,
					status: 'blocked',
					selected: selectedIds.has(entry.manifest.id),
					dependency: !selectedIds.has(entry.manifest.id),
					sourcePath: entry.relativePath,
					startedAt: now,
					completedAt: now,
					steps: [],
					evidence: [],
					diagnostics: resolution.diagnostics,
				});
				continue;
			}
			results.push(await runGuaranteeSteps({
				workspaceRoot,
				environment,
				runId,
				outputRoot,
				guarantee: entry,
				selected: selectedIds.has(entry.manifest.id),
				dependency: !selectedIds.has(entry.manifest.id),
				resolutions: allResolutions,
				sceneExecutor: input.sceneExecutor ?? defaultTreeseedGuaranteeSceneExecutor,
				verifierExecutor: input.verifierExecutor ?? defaultTreeseedGuaranteeVerifierExecutor,
				verifierCache,
				record: input.record,
				sceneArtifacts: input.sceneArtifacts,
				device: input.device,
			}));
		}
	}
	const completedAt = new Date().toISOString();
	const releaseBlockingFailures = results.filter((result) => {
		const entry = runEntries.find((candidate) => candidate.manifest.id === result.id);
		return entry && releaseBlocking(entry.manifest) && ['failed', 'blocked', ...(input.failOnSkippedReleaseGuarantees === true ? ['skipped' as const] : [])].includes(result.status);
	}).length;
	const counts = {
		planned: plan.entries.filter((entry) => entry.status !== 'active').length,
		passed: results.filter((entry) => entry.status === 'passed').length,
		failed: results.filter((entry) => entry.status === 'failed').length,
		skipped: results.filter((entry) => entry.status === 'skipped').length,
		blocked: results.filter((entry) => entry.status === 'blocked').length,
		releaseBlockingFailures,
	};
	const report: TreeseedGuaranteeRunReport = {
		ok: registry.ok && plan.ok && counts.failed === 0 && counts.blocked === 0 && releaseBlockingFailures === 0,
		runId,
		workspaceRoot,
		environment,
		filter,
		startedAt,
		completedAt,
		outputRoot,
		plan,
		results,
		diagnostics,
		counts,
	};
	const writeResult = writeTreeseedGuaranteeRunReport({ report, registry });
	if (!writeResult.ok) {
		report.ok = false;
		report.diagnostics.push(...writeResult.diagnostics);
	}
	return report;
}

export function createTreeseedGuaranteeStatusReport(input: { workspaceRoot: string }) {
	const registry = discoverTreeseedGuarantees({ workspaceRoot: input.workspaceRoot });
	const valid = registry.guarantees.filter((entry): entry is TreeseedLoadedGuarantee & { manifest: TreeseedGuaranteeManifest } => Boolean(entry.manifest));
	const byType: Record<string, number> = {};
	const byStatus: Record<string, number> = {};
	for (const entry of valid) {
		byType[entry.manifest.type] = (byType[entry.manifest.type] ?? 0) + 1;
		byStatus[entry.manifest.status] = (byStatus[entry.manifest.status] ?? 0) + 1;
	}
	return {
		ok: registry.ok,
		workspaceRoot: resolve(input.workspaceRoot),
		guaranteeRoots: sortedUnique(valid.map((entry) => dirname(entry.relativePath).split(sep).slice(0, 3).join('/'))),
		counts: registry.counts,
		byType,
		byStatus,
		verifierRegistries: registry.verifierRegistries.length,
		diagnostics: registry.diagnostics,
	};
}

export function assertPathInsideWorkspace(workspaceRoot: string, path: string) {
	const resolvedWorkspace = resolve(workspaceRoot);
	const resolvedPath = resolve(path);
	if (resolvedPath !== resolvedWorkspace && !resolvedPath.startsWith(`${resolvedWorkspace}${sep}`)) {
		throw new Error(`Path is outside workspace: ${path}`);
	}
	return resolvedPath;
}

export function fileExists(path: string) {
	return existsSync(path) && statSync(path).isFile();
}
