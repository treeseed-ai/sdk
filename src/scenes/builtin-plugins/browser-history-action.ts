import type { SceneActionHandler } from '../types.ts';
import { sceneErrorDiagnostic } from '../support/reporting/diagnostics.ts';

export const browserHistoryAction: SceneActionHandler = {
	id: 'browserHistory',
	phase: 2,
	status: 'available',
	summary: 'Move backward or forward through browser history.',
	async run({ action, context }) {
		if (!('browserHistory' in action)) return { ok: false, diagnostics: [sceneErrorDiagnostic('scene.invalid_action', 'Expected browserHistory action.', 'workflow.action.browserHistory')] };
		const navigate = action.browserHistory === 'forward' ? context.session.page.goForward : context.session.page.goBack;
		if (!navigate) return { ok: false, diagnostics: [sceneErrorDiagnostic('scene.unsupported_runtime_action', `The active browser adapter does not support history ${action.browserHistory}.`, 'workflow.action.browserHistory')] };
		await navigate.call(context.session.page, { waitUntil: 'domcontentloaded', timeout: 10_000 });
		return { ok: true, diagnostics: [] };
	},
};
