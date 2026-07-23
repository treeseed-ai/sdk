import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { TreeseedGuaranteeJourneyAuditItem } from './treeseed-guarantee-journey-audit-item.ts';

export const TREESEED_GUARANTEE_SCHEMA_VERSION = 'treeseed.guarantee/v1' as const;

export const TREESEED_GUARANTEE_VERIFIERS_SCHEMA_VERSION = 'treeseed.guarantee-verifiers/v1' as const;

export const TREESEED_GUARANTEE_JOURNEY_AUDIT_SCHEMA_VERSION = 'treeseed.guarantee-journey-audit/v1' as const;

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
	dependsOnGuarantees?: string[];
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
	ownerPackages?: string[];
	sceneBacked?: boolean;
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
	dependencyDepth: number;
	dependencyOf: string[];
	dependsOn: string[];
	dependencyReason: Array<'explicit-guarantee' | 'journey-index' | 'depends-on-verifier' | 'implicit-auth' | 'state'>;
	executionOrder: number;
	blockedBy?: string[];
	producesState?: string[];
	consumesState?: string[];
};

export type TreeseedGuaranteeJourneyAudit = {
	schemaVersion: typeof TREESEED_GUARANTEE_JOURNEY_AUDIT_SCHEMA_VERSION;
	workspaceRoot: string;
	generatedAt: string;
	totals: {
		guarantees: number;
		sceneBacked: number;
		activeSceneBacked: number;
		weakSceneContracts: number;
		missingRoutes: number;
		missingSelectors: number;
		dependencyErrors: number;
		activeSceneBackedWeak: number;
		activeMissingRoutes: number;
		activeMissingSelectors: number;
	};
	items: TreeseedGuaranteeJourneyAuditItem[];
	diagnostics: TreeseedGuaranteeDiagnostic[];
	ok: boolean;
};
