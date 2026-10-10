import { expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { sdkGoldenWorkdayId } from '../../../acceptance/golden-product.ts';
import { workdayStartFixture } from './workday-start-fixture.ts';

it('selects only the API-issued SDK workday through the retained receipt without listing proposal matches', () => {
	const f = workdayStartFixture();
	try {
		const read = vi.fn((args: string[]) => {
			expect(args).toEqual(['workdays', 'show', f.receipt.workdayId]); return { run: f.run };
		});
		expect(Reflect.apply(sdkGoldenWorkdayId, undefined, [read, f.freeze, undefined, f.path])).toBe(f.receipt.workdayId);
		expect(read).toHaveBeenCalledTimes(1); expect(readFileSync(f.path)).toEqual(f.bytes);
		expect(JSON.parse(readFileSync(f.retained, 'utf8'))).toEqual(f.receipt);
	} finally { f.close(); }
	expect(existsSync(f.root)).toBe(false);
});
