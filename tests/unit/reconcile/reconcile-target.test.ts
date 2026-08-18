import { describe,expect,it } from 'vitest';
import { reconcileDiffNeedsApply } from '../../../src/reconcile/engine/reconcile-target.ts';

describe('reconcile target apply boundary', () => {
	it('does not enter a mutation adapter for an exact noop plan', () => {
		expect(reconcileDiffNeedsApply({ action: 'noop', reasons: ['live state matches'], before: {}, after: {} })).toBe(false);
	});

	it.each(['create', 'update', 'replace', 'delete', 'adopt', 'rename', 'reattach', 'retain', 'taint', 'blocked'] as const)(
		'preserves adapter handling for %s plans',
		(action) => expect(reconcileDiffNeedsApply({ action, reasons: ['change'], before: {}, after: {} })).toBe(true),
	);
});
