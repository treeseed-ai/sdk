import { describe, expect, it } from 'vitest';
import { parseCommunicationAddresses } from '../../../src/operator-contracts/communication/addressing.ts';

describe('communication addressing', () => {
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
