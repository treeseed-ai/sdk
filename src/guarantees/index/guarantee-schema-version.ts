import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { GuaranteeJourneyAuditItem } from './guarantee-journey-audit-item.ts';

export const GUARANTEE_SCHEMA_VERSION = 'treeseed.guarantee/v1' as const;

export const GUARANTEE_VERIFIERS_SCHEMA_VERSION = 'treeseed.guarantee-verifiers/v1' as const;

export const GUARANTEE_JOURNEY_AUDIT_SCHEMA_VERSION = 'treeseed.guarantee-journey-audit/v1' as const;

export type GuaranteeSchemaVersion = typeof GUARANTEE_SCHEMA_VERSION;

export type GuaranteeVerifiersSchemaVersion = typeof GUARANTEE_VERIFIERS_SCHEMA_VERSION;

export type GuaranteeGate = 'smoke' | 'core' | 'release' | 'security' | 'migration' | 'demo' | 'backlog' | 'future';

export type GuaranteeStatus = 'active' | 'planned' | 'blocked' | 'backlog' | 'deprecated';

export type GuaranteeSurface =
	| 'admin-ui'
	| 'agent-runtime'
	| 'api-control-plane'
	| 'market-ui'
	| 'cli'
	| 'scene'
	| 'content-runtime';

export type GuaranteeDevice =
	| 'desktop_chromium'
	| 'desktop_firefox'
	| 'desktop_webkit'
	| 'tablet_chromium'
	| 'mobile_chromium'
	| 'mobile_webkit';

export type GuaranteeDiagnosticSeverity = 'error' | 'warning';

export type GuaranteeDiagnostic = {
	severity: GuaranteeDiagnosticSeverity;
	code: string;
	message: string;
	path?: string;
	sourcePath?: string;
};

export type GuaranteeVerifierContract = {
	required?: boolean;
	verifierRefs?: string[];
};

export type GuaranteeApiContract = GuaranteeVerifierContract;

export type GuaranteeSceneContract = {
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

export type GuaranteeNegativeCase = {
	id: string;
	actor?: string;
	verifierRefs?: string[];
	notes?: string[];
};

export type GuaranteeDependencies = {
	journeys?: number[];
	guarantees?: string[];
};

export type GuaranteeRunContract = {
	timeoutSeconds?: number;
	allowSkipped?: boolean;
	requiredForRelease?: boolean;
};

export type GuaranteeManifest = {
	schemaVersion: GuaranteeSchemaVersion;
	id: string;
	journeyIndex?: number;
	type: string;
	subtype: string;
	journey: string;
	ownerPackage: string;
	surface?: GuaranteeSurface;
	summary: string;
	status: GuaranteeStatus;
	run?: GuaranteeRunContract;
	dependencies: GuaranteeDependencies;
	actors: {
		allowed: string[];
		forbidden: string[];
	};
	devices: {
		required: GuaranteeDevice[];
		optional?: GuaranteeDevice[];
	};
	gates: GuaranteeGate[];
	preconditions: {
		fixtures?: string[];
		notes?: string[];
	};
	scene?: GuaranteeSceneContract;
	api?: GuaranteeApiContract;
	content?: GuaranteeVerifierContract;
	audit?: GuaranteeVerifierContract;
	negativeCases?: GuaranteeNegativeCase[];
	evidence: {
		required: string[];
		optional?: string[];
	};
	notes?: string[];
	dependsOnGuarantees?: string[];
};

export type LoadedGuarantee = {
	sourcePath: string;
	relativePath: string;
	packageRoot: string;
	ownerPackage: string;
	manifest: GuaranteeManifest | null;
	diagnostics: GuaranteeDiagnostic[];
};

export type GuaranteeVerifierKind =
	| 'apiAcceptanceCase'
	| 'vitestCase'
	| 'nodeScript'
	| 'packageScript'
	| 'scene'
	| 'manualEvidence'
	| 'todo';

export type GuaranteeVerifierDefinition = {
	kind: GuaranteeVerifierKind;
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

export type GuaranteeVerifierRegistry = {
	schemaVersion: GuaranteeVerifiersSchemaVersion;
	ownerPackage: string;
	verifiers: Record<string, GuaranteeVerifierDefinition>;
};

export type LoadedGuaranteeVerifierRegistry = {
	sourcePath: string;
	ownerPackage: string;
	registry: GuaranteeVerifierRegistry | null;
	diagnostics: GuaranteeDiagnostic[];
};

export type GuaranteeFilter = {
	gate?: GuaranteeGate;
	type?: string;
	subtype?: string;
	ownerPackage?: string;
	ownerPackages?: string[];
	sceneBacked?: boolean;
	status?: GuaranteeStatus;
	ids?: string[];
	journeyIndexes?: number[];
};

export type GuaranteeRegistryReport = {
	ok: boolean;
	workspaceRoot: string;
	guarantees: LoadedGuarantee[];
	verifierRegistries: LoadedGuaranteeVerifierRegistry[];
	diagnostics: GuaranteeDiagnostic[];
	counts: {
		total: number;
		valid: number;
		selected?: number;
		errors: number;
		warnings: number;
	};
};

export type GuaranteePlanEntry = {
	id: string;
	journeyIndex?: number;
	type: string;
	subtype: string;
	journey: string;
	ownerPackage: string;
	surface?: GuaranteeSurface;
	status: GuaranteeStatus;
	gates: GuaranteeGate[];
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

export type GuaranteeJourneyAudit = {
	schemaVersion: typeof GUARANTEE_JOURNEY_AUDIT_SCHEMA_VERSION;
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
	items: GuaranteeJourneyAuditItem[];
	diagnostics: GuaranteeDiagnostic[];
	ok: boolean;
};
