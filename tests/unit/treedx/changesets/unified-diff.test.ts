import { describe,expect,it } from 'vitest';
import { createUnifiedChangeset } from '../../../../src/treedx/changesets/unified-diff.ts';

describe('TreeDX unified changesets', () => {
	it('bundles create, update, and delete and is smaller than full-document writes', () => {
		const before = Array.from({ length: 2_000 }, (_, index) => `line ${index}`).join('\n');
		const after = before.replace('line 1000', 'line 1000 updated');
		const patch = createUnifiedChangeset([
			{ path: 'docs/large.md', before, after },
			{ path: 'docs/new.md', before: null, after: 'new\n' },
			{ path: 'docs/old.md', before: 'old\n', after: null },
		]);

		expect(patch).toContain('diff --git a/docs/large.md b/docs/large.md');
		expect(patch).toContain('--- /dev/null');
		expect(patch).toContain('+++ /dev/null');
		expect(Buffer.byteLength(patch)).toBeLessThan(Buffer.byteLength(JSON.stringify({ content: after })) / 20);
	});

	it('rejects duplicate paths before making a request', () => {
		expect(() => createUnifiedChangeset([
			{ path: 'docs/a.md', before: null, after: 'one' },
			{ path: 'docs/a.md', before: 'one', after: 'two' },
		])).toThrow(/Duplicate changeset path/u);
	});
});
