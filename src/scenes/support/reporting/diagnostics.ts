import type { SceneDiagnostic } from '../../types.ts';

export function sceneErrorDiagnostic(code: string, message: string, path?: string): SceneDiagnostic {
	return { severity: 'error', code, message, path };
}

export function sceneWarningDiagnostic(code: string, message: string, path?: string): SceneDiagnostic {
	return { severity: 'warning', code, message, path };
}

export function hasSceneErrors(diagnostics: SceneDiagnostic[]) {
	return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

export function formatSceneDiagnostics(diagnostics: SceneDiagnostic[]) {
	return diagnostics.map((diagnostic) => {
		const prefix = diagnostic.severity === 'error' ? 'ERROR' : 'WARN';
		const location = diagnostic.path ? ` ${diagnostic.path}` : '';
		return `${prefix} ${diagnostic.code}${location}: ${diagnostic.message}`;
	});
}
