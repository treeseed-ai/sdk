import { describe,expect,it } from 'vitest';
import { compileDefaultChatActivityProfile } from '../../../../src/agent-capacity/authoring/chat-activity-profile.ts';
import { compileAgentAuthoritySnapshot } from '../../../../src/agent-capacity/authority/agent-authority-presets.ts';

describe('shared chat activity profile', () => {
	it('compiles discussion, operational closeout, and bounded content authority', () => {
		const profile = compileDefaultChatActivityProfile('guide-writer', {
			foundation: 'discussion-v1', responseStyle: 'Reader-centered.',
		});
		expect(profile.tools.allowed).toEqual(expect.arrayContaining([
			'treeseed.assignment_plan', 'treeseed.assignment_status_update', 'treeseed.assignment_summary',
			'treeseed.discussion.read', 'treeseed.discussion.follow', 'treeseed.discussion.respond',
			'treeseed.discussion.request_handoff', 'treeseed.operation.prepare_handoff',
		]));
		expect(profile.permissions?.content.discussion_message?.operations).toEqual(['describe', 'query', 'read']);
		expect(profile.permissions?.content.knowledge?.operations).toEqual(['describe', 'query', 'read']);
		expect(profile.planningIntent).toMatchObject({
			artifactKind: 'discussion_response', subjectModel: 'discussion_message', subjectId: null,
		});
		expect(profile.branchPolicy).toEqual({ kind: 'staging-content', base: 'staging' });
		expect(profile.prompt.system).toContain('Response style: Reader-centered.');
	});

	it('cannot widen Chat into repository, governance, infrastructure, or raw TreeDX mutation authority', () => {
		const profile = compileDefaultChatActivityProfile('guide-writer', {
			foundation: 'discussion-v1',
			toolAdditions: ['treeseed.repository.write_file', 'treeseed.governance.decide', 'treeseed.infrastructure.apply', 'treedx.commit_workspace'],
		});
		profile.permissions = {
			...profile.permissions!,
			repository: { readPaths: ['**'], writePaths: ['**'], allowCodeMutation: true },
			shell: { allowCommands: true, allowedCommands: ['*'] },
		};
		const compiled = compileAgentAuthoritySnapshot('chat', profile);
		expect(compiled.tools.allowed).not.toEqual(expect.arrayContaining([
			'treeseed.repository.write_file', 'treeseed.governance.decide', 'treeseed.infrastructure.apply', 'treedx.commit_workspace',
		]));
		expect(compiled.permissions?.repository).toMatchObject({ writePaths: [], allowCodeMutation: false });
		expect(compiled.permissions?.shell).toMatchObject({ allowCommands: false, allowedCommands: [] });
		expect(compiled.diagnostics).toEqual(expect.arrayContaining([
			'chat cannot enable repository code mutation.', 'Chat cannot use treeseed.governance.decide.',
		]));
	});
});
