import type { TreeseedSceneDiagnostic } from './types.ts';

export function sceneErrorDiagnostic(code: string, message: string, path?: string): TreeseedSceneDiagnostic {
	return { severity: 'error', code, message, path };
}

export function sceneWarningDiagnostic(code: string, message: string, path?: string): TreeseedSceneDiagnostic {
	return { severity: 'warning', code, message, path };
}

export function hasTreeseedSceneErrors(diagnostics: TreeseedSceneDiagnostic[]) {
	return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

export function formatTreeseedSceneDiagnostics(diagnostics: TreeseedSceneDiagnostic[]) {
	return diagnostics.map((diagnostic) => {
		const prefix = diagnostic.severity === 'error' ? 'ERROR' : 'WARN';
		const location = diagnostic.path ? ` ${diagnostic.path}` : '';
		return `${prefix} ${diagnostic.code}${location}: ${diagnostic.message}`;
	});
}
