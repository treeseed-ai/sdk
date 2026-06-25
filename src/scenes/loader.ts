import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { sceneErrorDiagnostic } from './diagnostics.ts';
import type { LoadedTreeseedSceneDocument, TreeseedSceneDiagnostic } from './types.ts';

const FILESYSTEM_SAFE_SCENE_ID = /^[a-z0-9][a-z0-9._-]*$/u;

export function resolveTreeseedScenePath(projectRoot: string, sceneNameOrPath: string) {
	const value = sceneNameOrPath.trim();
	if (/\.(?:ya?ml)$/iu.test(value)) {
		return isAbsolute(value) ? value : resolve(projectRoot, value);
	}
	return resolve(projectRoot, 'scenes', `${value}.yaml`);
}

export function loadTreeseedSceneDocument(projectRoot: string, sceneNameOrPath: string): LoadedTreeseedSceneDocument {
	const diagnostics: TreeseedSceneDiagnostic[] = [];
	const trimmed = sceneNameOrPath.trim();
	const path = resolveTreeseedScenePath(projectRoot, trimmed);
	if (!/\.(?:ya?ml)$/iu.test(trimmed) && !FILESYSTEM_SAFE_SCENE_ID.test(trimmed)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_name', `Scene name must be a simple file-safe identifier: ${sceneNameOrPath}.`, 'scene'));
		return { path, value: null, diagnostics };
	}
	if (!existsSync(path)) {
		diagnostics.push(sceneErrorDiagnostic('scene.not_found', `Scene manifest not found at ${path}.`, 'manifest'));
		return { path, value: null, diagnostics };
	}
	const source = readFileSync(path, 'utf8');
	const document = parseDocument(source, { prettyErrors: false });
	for (const parseError of document.errors) {
		diagnostics.push(sceneErrorDiagnostic('scene.yaml_parse_error', parseError.message, 'manifest'));
	}
	if (diagnostics.length > 0) {
		return { path, value: null, diagnostics };
	}
	return { path, value: document.toJSON(), diagnostics };
}
