import type { GuaranteeDiagnostic } from '../index/guarantee-schema-version.ts';
import { diagnostic } from '../index/guarantee-journey-audit-item.ts';

type ObservedError = {
	message?: string;
	method?: string;
	status?: number;
	url?: string;
};

type RuntimeStep = {
	id?: string;
	consoleErrors?: ObservedError[];
	networkErrors?: ObservedError[];
};

export function unexpectedUiSceneRuntimeDiagnostics(
	report: { steps?: RuntimeStep[] },
	sourcePath?: string,
): GuaranteeDiagnostic[] {
	const diagnostics: GuaranteeDiagnostic[] = [];
	for (const step of report.steps ?? []) {
		for (const observed of step.consoleErrors ?? []) {
			const browserStatus = observed.message?.match(/status of (\d{3})/iu)?.[1];
			const isExpectedClientResponse = browserStatus
				? (step.networkErrors ?? []).some((entry) => (
					entry.status === Number(browserStatus)
					&& entry.status >= 400
					&& entry.status < 500
				))
				: false;
			if (/^Failed to load resource:/iu.test(observed.message ?? '') && isExpectedClientResponse) continue;
			diagnostics.push(diagnostic(
				'error',
				'guarantee.scene_unexpected_console_error',
				`Browser console error${step.id ? ` during ${step.id}` : ''}: ${observed.message ?? 'unknown console error'}.`,
				'scene.console',
				sourcePath,
			));
		}
		for (const observed of step.networkErrors ?? []) {
			if (typeof observed.status === 'number' && observed.status < 500) continue;
			const request = [observed.method, observed.url].filter(Boolean).join(' ');
			diagnostics.push(diagnostic(
				'error',
				'guarantee.scene_unexpected_network_error',
				`Browser network failure${step.id ? ` during ${step.id}` : ''}${request ? ` (${request})` : ''}: ${observed.message ?? `HTTP ${observed.status ?? 'failure'}`}.`,
				'scene.network',
				sourcePath,
			));
		}
	}
	return diagnostics;
}
