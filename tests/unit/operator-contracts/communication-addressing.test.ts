import { describe, expect, it } from 'vitest';
import { parseCommunicationAddresses } from '../../../src/operator-contracts/communication/addressing.ts';
import { communicationSendRequestSchema } from '../../../src/operator-contracts/communication/contracts.ts';
import { TREESEED_COMMAND_TREE_V1 } from '../../../src/operator-contracts/canonical-command-tree.ts';

describe('communication addressing', () => {
	it('accepts an exact parent workday without caller-authored budgets or graph state', () => {
		const input = { message: '@sdk/architect Assess the proposal.', proposalId: 'proposal', parentWorkdayId: 'workday' };
		expect(communicationSendRequestSchema.parse(input)).toEqual(input);
		expect(communicationSendRequestSchema.safeParse({ ...input, parentWorkdayId: '' }).success).toBe(false);
		expect(communicationSendRequestSchema.safeParse({ ...input, reservedSeconds: 180 }).success).toBe(false);
		const send = TREESEED_COMMAND_TREE_V1.commands.find(command => command.segment === 'send');
		expect(send?.nodeType).toBe('leaf');
		if (send?.nodeType !== 'leaf') throw new Error('Missing send command');
		expect(send.options?.some(option => option.name === '--workday')).toBe(true);
		expect(send.execution).toMatchObject({ input: expect.arrayContaining([
			expect.objectContaining({ target: 'body', field: 'parentWorkdayId', source: 'option', name: 'workday' }),
		]) });
	});
	it('classifies the initial address block as required and later mentions as optional', () => {
		expect(parseCommunicationAddresses('@architect @sdk/reviewer Please assess this.\n\nAsk @tester too.')).toEqual([
			{ projectSlug: null, agentSlug: 'architect', requirement: 'required', address: '@architect' },
			{ projectSlug: 'sdk', agentSlug: 'reviewer', requirement: 'required', address: '@sdk/reviewer' },
			{ projectSlug: null, agentSlug: 'tester', requirement: 'optional', address: '@tester' },
		]);
	});

	it('ignores quoted history, code, links, and email addresses while required wins duplicates', () => {
		const message = '> @quoted old message\n\nContact person@example.com or [@linked](https://example.com). `@inline`\n```ts\n@fenced\n```\nMention @reviewer.\n@reviewer';
		expect(parseCommunicationAddresses(message)).toEqual([
			{ projectSlug: null, agentSlug: 'reviewer', requirement: 'optional', address: '@reviewer' },
		]);
	});
});
