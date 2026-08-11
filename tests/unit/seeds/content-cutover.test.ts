import { describe, expect, it } from 'vitest';
import { classifyContentCutover, type ContentCutoverEvidence } from '../../../src/seeds/repositories/content-cutover.ts';

function evidence(overrides: Partial<ContentCutoverEvidence> = {}): ContentCutoverEvidence {
	return {
		project: 'admin',
		branch: 'staging',
		sourceRepository: 'treeseed-ai/admin',
		targetRepository: 'treeseed-ai/admin-content',
		contentPath: 'docs/src/content',
		sourceCommit: 'source',
		targetCommit: 'target',
		sourceTree: 'tree',
		targetTree: 'tree',
		historyVerified: true,
		publicationContract: 'treeseed.content-publication/v3',
		publicationRevision: 'revision',
		publicationVerified: true,
		treeDxResolvedRef: 'target',
		treeDxVerified: true,
		...overrides,
	};
}

describe('content cutover classification', () => {
	it('allows removal only when Git, history, TreeDX, and R2 evidence agree', () => {
		expect(classifyContentCutover(evidence())).toMatchObject({ status: 'ready', blockers: [] });
	});

	it.each([
		[{ sourceTree: 'old' }, 'repository trees differ'],
		[{ historyVerified: false }, 'history migration receipt'],
		[{ publicationVerified: false }, 'R2 publication receipt'],
		[{ treeDxVerified: false }, 'TreeDX has not freshly verified'],
	] as const)('fails closed for incomplete cutover evidence', (override, message) => {
		const plan = classifyContentCutover(evidence(override));
		expect(plan.status).toBe('blocked');
		expect(plan.blockers.join(' ')).toContain(message);
	});
});
