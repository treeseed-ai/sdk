import { sceneErrorDiagnostic } from '../support/reporting/diagnostics.ts';
import type { SceneActionHandler } from '../types.ts';

export const clickVisibleSequenceAction: SceneActionHandler = {
	id: 'clickVisibleSequence',
	phase: 2,
	status: 'available',
	summary: 'Click each currently visible selector in order as responsive controls reveal the next action.',
	async run({ action, context }) {
		if (!('clickVisibleSequence' in action)) {
			return {
				ok: false,
				diagnostics: [sceneErrorDiagnostic('scene.invalid_action', 'Expected clickVisibleSequence action.', 'workflow.action.clickVisibleSequence')],
			};
		}
		let clickCount = 0;
		for (const selector of action.clickVisibleSequence) {
			const locator = context.resolveSelector(selector);
			if (!(await locator.isVisible())) continue;
			await locator.click();
			clickCount += 1;
		}
		return clickCount > 0
			? { ok: true, diagnostics: [] }
			: {
				ok: false,
				diagnostics: [sceneErrorDiagnostic(
					'scene.visible_action_missing',
					'None of the responsive click sequence controls were visible.',
					'workflow.action.clickVisibleSequence',
				)],
			};
	},
};
