import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { EXCLUDED_DIRS, GUARANTEE_ID_PATTERN, KNOWN_DEVICES, KNOWN_GATES, KNOWN_STATUSES, KNOWN_SURFACES, TAXONOMY_PATTERN, diagnostic, isRecord, numberArray, numberValue, readYamlFile, stringArray, stringValue } from './treeseed-guarantee-journey-audit-item.ts';
import { TREESEED_GUARANTEE_SCHEMA_VERSION, TreeseedGuaranteeDevice, TreeseedGuaranteeDiagnostic, TreeseedGuaranteeGate, TreeseedGuaranteeManifest, TreeseedGuaranteeRunContract, TreeseedGuaranteeSceneContract, TreeseedGuaranteeStatus, TreeseedGuaranteeSurface, TreeseedGuaranteeVerifierContract, TreeseedLoadedGuarantee } from './treeseed-guarantee-schema-version.ts';
import { allVerifierRefs } from './parse-verifier-registry.ts';

export function walkFiles(root: string, predicate: (path: string) => boolean): string[] {
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

export function nearestPackageRoot(workspaceRoot: string, filePath: string) {
	const packagesRoot = resolve(workspaceRoot, 'packages');
	if (filePath.startsWith(`${packagesRoot}${sep}`)) {
		const [packageName] = relative(packagesRoot, filePath).split(sep);
		if (packageName) return resolve(packagesRoot, packageName);
	}
	return workspaceRoot;
}

export function ownerPackageFromRoot(packageRoot: string) {
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

export function validateTaxonomyPath(input: { workspaceRoot: string; sourcePath: string; manifest: TreeseedGuaranteeManifest; diagnostics: TreeseedGuaranteeDiagnostic[] }) {
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

export function parseContract(value: unknown): TreeseedGuaranteeVerifierContract | undefined {
	if (!isRecord(value)) return undefined;
	return {
		...(typeof value.required === 'boolean' ? { required: value.required } : {}),
		verifierRefs: stringArray(value.verifierRefs),
	};
}

export function parseRunContract(value: unknown): TreeseedGuaranteeRunContract | undefined {
	if (!isRecord(value)) return undefined;
	const timeoutSeconds = numberValue(value.timeoutSeconds);
	return {
		...(timeoutSeconds && timeoutSeconds > 0 ? { timeoutSeconds } : {}),
		...(typeof value.allowSkipped === 'boolean' ? { allowSkipped: value.allowSkipped } : {}),
		...(typeof value.requiredForRelease === 'boolean' ? { requiredForRelease: value.requiredForRelease } : {}),
	};
}

export function parseScene(value: unknown): TreeseedGuaranteeSceneContract | undefined {
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

export function parseGuaranteeManifest(value: unknown, diagnostics: TreeseedGuaranteeDiagnostic[], sourcePath: string): TreeseedGuaranteeManifest | null {
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

	const dependsOnGuarantees = Array.isArray(value.dependsOnGuarantees)
		? value.dependsOnGuarantees.map((entry) => {
				if (typeof entry === 'string') return entry;
				if (!isRecord(entry)) return '';
				return typeof entry.ref === 'string' && typeof entry.ownerPackage === 'string'
					? `${entry.ownerPackage}:${entry.ref}`
					: stringValue(entry.ref);
			}).filter(Boolean)
		: [];
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
		dependsOnGuarantees,
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
