import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type {
	GuaranteeDevice,
	GuaranteeDiagnostic,
	GuaranteeManifest,
	LoadedGuarantee,
} from '../index/guarantee-schema-version.ts';
import {
	arrayOrEmpty,
	diagnostic,
	isRecord,
	stringArray,
	stringValue,
} from '../index/guarantee-journey-audit-item.ts';
import { readSceneYaml, sceneManifestPathForGuarantee } from '../index/parse-verifier-registry.ts';

export const UI_FEATURE_SCHEMA_VERSION = 'treeseed.ui-feature/v1' as const;

export type UiFeatureCapability = {
	id: string;
	routes: string[];
	actions: string[];
	states: string[];
	allowedActors: string[];
	forbiddenActors: string[];
	guaranteeIds: string[];
};

export type UiFeatureContract = {
	schemaVersion: typeof UI_FEATURE_SCHEMA_VERSION;
	id: string;
	ownerPackage: string;
	routes: string[];
	devices: GuaranteeDevice[];
	states: string[];
	capabilities: UiFeatureCapability[];
	requiredGuarantees: string[];
	requirements: {
		accessibility: boolean;
		console: boolean;
		network: boolean;
		visual: boolean;
		durableState: boolean;
		cleanup: boolean;
	};
};

function parseCapability(value: unknown): UiFeatureCapability | null {
	if (!isRecord(value) || !stringValue(value.id)) return null;
	const actors = isRecord(value.actors) ? value.actors : {};
	return {
		id: stringValue(value.id),
		routes: stringArray(value.routes),
		actions: stringArray(value.actions),
		states: stringArray(value.states),
		allowedActors: stringArray(actors.allowed),
		forbiddenActors: stringArray(actors.forbidden),
		guaranteeIds: stringArray(value.guaranteeIds),
	};
}

export function parseUiFeatureContract(value: unknown): UiFeatureContract | null {
	if (!isRecord(value) || value.schemaVersion !== UI_FEATURE_SCHEMA_VERSION) return null;
	const requirements = isRecord(value.requirements) ? value.requirements : {};
	return {
		schemaVersion: UI_FEATURE_SCHEMA_VERSION,
		id: stringValue(value.id),
		ownerPackage: stringValue(value.ownerPackage),
		routes: stringArray(value.routes),
		devices: stringArray(value.devices) as GuaranteeDevice[],
		states: stringArray(value.states),
		capabilities: arrayOrEmpty(value.capabilities as unknown[]).map(parseCapability).filter(Boolean) as UiFeatureCapability[],
		requiredGuarantees: stringArray(value.requiredGuarantees),
		requirements: {
			accessibility: requirements.accessibility === true,
			console: requirements.console === true,
			network: requirements.network === true,
			visual: requirements.visual === true,
			durableState: requirements.durableState === true,
			cleanup: requirements.cleanup === true,
		},
	};
}

function sceneProves(entry: LoadedGuarantee & { manifest: GuaranteeManifest }) {
	const path = sceneManifestPathForGuarantee(entry);
	const scene = path && existsSync(path) ? readSceneYaml(path) : null;
	const journey = isRecord(scene?.journey) ? scene.journey : {};
	return stringArray(journey.proves);
}

function error(message: string, path: string, sourcePath: string) {
	return diagnostic('error', 'guarantee.ui_feature_contract_invalid', message, path, sourcePath);
}

export function validateUiFeatureContracts(input: {
	guarantees: Array<LoadedGuarantee & { manifest: GuaranteeManifest }>;
}): GuaranteeDiagnostic[] {
	const diagnostics: GuaranteeDiagnostic[] = [];
	const byId = new Map(input.guarantees.map((entry) => [entry.manifest.id, entry]));
	const loaded = new Map<string, { contract: UiFeatureContract; sourcePath: string }>();
	for (const entry of input.guarantees) {
		const reference = entry.manifest.uiFeature;
		if (!reference) continue;
		const sourcePath = resolve(dirname(entry.sourcePath), reference.contract);
		if (!existsSync(sourcePath)) {
			diagnostics.push(error(`UI feature contract does not exist: ${reference.contract}.`, 'uiFeature.contract', entry.sourcePath));
			continue;
		}
		let contract = loaded.get(sourcePath)?.contract;
		if (!contract) {
			try {
				contract = parseUiFeatureContract(parseYaml(readFileSync(sourcePath, 'utf8'))) ?? undefined;
			} catch {
				contract = undefined;
			}
			if (!contract) {
				diagnostics.push(error('UI feature contract is unreadable or has an unsupported schema.', 'uiFeature.contract', sourcePath));
				continue;
			}
			loaded.set(sourcePath, { contract, sourcePath });
		}
		if (contract.ownerPackage !== entry.manifest.ownerPackage) {
			diagnostics.push(error(`UI feature owner ${contract.ownerPackage} does not match ${entry.manifest.ownerPackage}.`, 'ownerPackage', sourcePath));
		}
		const capabilityIds = new Set(contract.capabilities.map((capability) => capability.id));
		const declared = reference.capabilities;
		const proved = sceneProves(entry);
		for (const capability of declared) {
			if (!capabilityIds.has(capability)) diagnostics.push(error(`Unknown UI feature capability "${capability}".`, 'uiFeature.capabilities', entry.sourcePath));
			if (!proved.includes(capability)) diagnostics.push(error(`Scene journey.proves must cite capability "${capability}".`, 'scene.journey.proves', entry.sourcePath));
		}
		if (entry.manifest.status === 'active' && ['admin-ui', 'market-ui'].includes(entry.manifest.surface ?? '')) {
			if (!entry.manifest.scene?.required || !entry.manifest.scene.manifest) {
				diagnostics.push(error('Active UI guarantees require a positive browser scene.', 'scene', entry.sourcePath));
			}
			for (const actor of entry.manifest.actors.forbidden) {
				const negative = arrayOrEmpty(entry.manifest.negativeCases).find((candidate) => candidate.actor === actor && candidate.sceneManifest);
				if (!negative) diagnostics.push(error(`Forbidden actor "${actor}" requires a negative browser scene.`, 'negativeCases', entry.sourcePath));
			}
		}
	}
	for (const { contract, sourcePath } of loaded.values()) {
		const capabilityIds = new Set(contract.capabilities.map((entry) => entry.id));
		for (const capability of contract.capabilities) {
			if (capability.routes.length === 0 || capability.actions.length === 0 || capability.states.length === 0) {
				diagnostics.push(error(`Capability "${capability.id}" must declare routes, actions, and states.`, 'capabilities', sourcePath));
			}
			for (const id of capability.guaranteeIds) {
				const guarantee = byId.get(id);
				if (!guarantee) diagnostics.push(error(`Capability "${capability.id}" references missing guarantee "${id}".`, 'capabilities.guaranteeIds', sourcePath));
				else if (!guarantee.manifest.uiFeature?.capabilities.includes(capability.id)) {
					diagnostics.push(error(`Guarantee "${id}" does not map back to capability "${capability.id}".`, 'capabilities.guaranteeIds', sourcePath));
				}
			}
		}
		for (const id of contract.requiredGuarantees) {
			const guarantee = byId.get(id);
			if (!guarantee) diagnostics.push(error(`Required guarantee "${id}" is missing.`, 'requiredGuarantees', sourcePath));
			else if (guarantee.manifest.status !== 'active') diagnostics.push(error(`Required guarantee "${id}" is ${guarantee.manifest.status}; UI feature contracts fail closed.`, 'requiredGuarantees', sourcePath));
		}
		const mapped = new Set(input.guarantees.flatMap((entry) => entry.manifest.uiFeature?.contract
			&& resolve(dirname(entry.sourcePath), entry.manifest.uiFeature.contract) === sourcePath
			? entry.manifest.uiFeature.capabilities
			: []));
		for (const id of capabilityIds) if (!mapped.has(id)) diagnostics.push(error(`Capability "${id}" has no guarantee coverage.`, 'capabilities', sourcePath));
		if (Object.values(contract.requirements).some((required) => !required)) {
			diagnostics.push(error('All production UI quality and cleanup requirements must be enabled.', 'requirements', sourcePath));
		}
	}
	return diagnostics;
}
