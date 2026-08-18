import { describe,expect,it } from 'vitest';
import { resolveSceneStepTimeoutSeconds } from '../../../../src/scenes/support/execution/timeouts.ts';
import type { SceneWorkflowStep } from '../../../../src/scenes/types.ts';

function operationStep(timeoutSeconds?: number, pollIntervalSeconds?: number): SceneWorkflowStep {
	return {
		id: 'await-operation',
		title: 'Await operation',
		action: {
			waitForOperation: {
				status: ['succeeded'],
				...(timeoutSeconds ? { timeoutSeconds } : {}),
				...(pollIntervalSeconds ? { pollIntervalSeconds } : {}),
			},
		},
	};
}

describe('scene step timeout resolution', () => {
	it('does not let the generic step timeout preempt an operation-specific timeout', () => {
		expect(resolveSceneStepTimeoutSeconds(operationStep(180, 2), 90)).toBe(182);
	});

	it('preserves a longer explicit step timeout and ordinary action defaults', () => {
		expect(resolveSceneStepTimeoutSeconds({ ...operationStep(30), timeoutSeconds: 240 }, 90)).toBe(240);
		expect(resolveSceneStepTimeoutSeconds({ id: 'open', title: 'Open', action: { goto: '/' } }, 90)).toBe(90);
	});
});
