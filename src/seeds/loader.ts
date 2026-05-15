import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { errorDiagnostic } from './errors.js';
import type { SeedDiagnostic } from './types.js';

export type LoadedSeedDocument = {
	path: string;
	value: unknown;
	diagnostics: SeedDiagnostic[];
};

export function resolveSeedManifestPath(projectRoot: string, seedName: string) {
	return resolve(projectRoot, 'seeds', `${seedName}.yaml`);
}

export function loadSeedManifest(projectRoot: string, seedName: string): LoadedSeedDocument {
	const path = resolveSeedManifestPath(projectRoot, seedName);
	const diagnostics: SeedDiagnostic[] = [];
	if (!/^[a-z0-9][a-z0-9._-]*$/u.test(seedName)) {
		diagnostics.push(errorDiagnostic('seed.invalid_name', `Seed name must be a simple file-safe identifier: ${seedName}.`, 'name'));
		return { path, value: null, diagnostics };
	}
	if (!existsSync(path)) {
		diagnostics.push(errorDiagnostic('seed.not_found', `Seed manifest not found at ${path}.`, 'manifest'));
		return { path, value: null, diagnostics };
	}

	const source = readFileSync(path, 'utf8');
	const document = parseDocument(source, { prettyErrors: false });
	for (const parseError of document.errors) {
		diagnostics.push(errorDiagnostic('seed.yaml_parse_error', parseError.message, 'manifest'));
	}
	if (diagnostics.length > 0) {
		return { path, value: null, diagnostics };
	}
	return { path, value: document.toJSON(), diagnostics };
}
