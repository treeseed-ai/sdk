import { describe, expect, it } from 'vitest';
import { parseCommunicationAddresses } from '../../../src/operator-contracts/communication/addressing.ts';
import { communicationSendRequestSchema, providerDiscussionResponseReceiptSchema } from '../../../src/operator-contracts/communication/contracts.ts';
import { TREESEED_COMMAND_TREE_V1 } from '../../../src/operator-contracts/canonical-command-tree.ts';

describe('communication addressing', () => {
	it('requires the exact committed response reference instead of a path-only completion claim', () => {
		const receipt = { schemaVersion: 'treeseed.provider-discussion-response-receipt/v1', assignmentId: 'assignment', invocationId: 'invocation',
			messageRef: 'discussion-messages/reply.mdx', status: 'responded', settledAt: '2026-09-26T10:00:00.000Z' };
		const reference = { kind: 'treedx', projectId: 'sdk', repository: 'repo_sdk', commit: 'a'.repeat(40), path: receipt.messageRef, workspaceId: 'workspace' };
		expect(providerDiscussionResponseReceiptSchema.safeParse(receipt).success).toBe(false);
		expect(providerDiscussionResponseReceiptSchema.parse({ ...receipt, reference }).reference).toEqual(reference);
		expect(providerDiscussionResponseReceiptSchema.safeParse({ ...receipt, reference: { ...reference, commit: 'staging' } }).success).toBe(false);
		expect(providerDiscussionResponseReceiptSchema.safeParse({ ...receipt, reference: { ...reference, path: 'other.mdx' } }).success).toBe(false);
	});
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
