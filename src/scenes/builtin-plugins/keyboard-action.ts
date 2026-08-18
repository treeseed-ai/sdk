import type { SceneActionHandler } from '../types.ts';
import { sceneErrorDiagnostic } from '../support/reporting/diagnostics.ts';

export const keyboardAction: SceneActionHandler = {
	id: 'keyboard',
	phase: 2,
	status: 'available',
	summary: 'Send keyboard input.',
	async run({ action, context }) {
		if (!('keyboard' in action)) return { ok: false, diagnostics: [sceneErrorDiagnostic('scene.invalid_action', 'Expected keyboard action.', 'workflow.action.keyboard')] };
		await context.session.page.keyboard.press(action.keyboard);
		return { ok: true, diagnostics: [] };
	},
};
