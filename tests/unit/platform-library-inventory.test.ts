import { describe, expect, it } from 'vitest';
import { inventorySchema } from '../../src/platform/schemas.ts';
import { planPlatformWorkset } from '../../src/platform/workset.ts';

describe('library-only Platform inventory', () => {
	const project = { key: 'project:team', slug: 'team', kind: 'content', libraryRepository: 'repository:team-library' };
	it('accepts content projects but still requires sources for software', () => {
		const parse = (entry: unknown) => inventorySchema.safeParse({ schemaVersion: 'treeseed.seed-bundle/v3', resources: { projects: [entry], repositories: [] } });
		expect(parse(project).success).toBe(true);
		expect(parse({ ...project, kind: 'package' }).success).toBe(false);
		expect(parse({ ...project, libraryRepository: undefined }).success).toBe(false);
	});
	it('never materializes a content-only library, including explicit selection', () => {
		for (const projects of [[], ['team']]) {
			const plan = planPlatformWorkset({ root: process.cwd(), inventoryPath: 'seed.yaml', inventoryDigest: 'sha256:fixture',
				inventory: { schemaVersion: 'treeseed.seed-bundle/v3', resources: { projects: [project], repositories: [] } },
				selection: { projects }, remote: { observe: () => { throw new Error('Must not access library Git'); }, isAncestor: () => false } });
			expect(plan.entries).toEqual([]);
			expect(plan.ok).toBe(true);
		}
	});
});
