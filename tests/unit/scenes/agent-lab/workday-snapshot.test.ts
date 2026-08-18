import { describe,expect,it,vi } from 'vitest';
import { hydrateAgentLabArtifacts } from '../../../../src/scenes/agent-lab/workday-snapshot.ts';

function execution(artifacts: Record<string, unknown>[]) {
	return { assignment: {}, artifacts } as never;
}

describe('Agent Lab workday artifact hydration', () => {
	it('reuses immutable artifact content across live snapshot refreshes', async () => {
		const read = vi.fn(async () => ({ payload: { files: [{
			path: 'src/content/notes/evidence.mdx', content: 'new content',
		}] } }));
		const client = { treeDxReadRepositoryFiles: read } as never;
		const reference = { contentPath: 'src/content/notes/evidence.mdx', commitSha: 'commit-a' };
		const previous = [execution([{ ...reference, content: 'cached content', bytes: 14, characters: 14 }])];

		const cached = await hydrateAgentLabArtifacts(client, 'project-a', 'repository-a', [execution([reference])], previous);
		expect(cached[0]?.artifacts[0]).toMatchObject({ content: 'cached content', commitSha: 'commit-a' });
		expect(read).not.toHaveBeenCalled();

		await hydrateAgentLabArtifacts(client, 'project-a', 'repository-a', [execution([{ ...reference, commitSha: 'commit-b' }])], previous);
		expect(read).toHaveBeenCalledOnce();
	});
});
