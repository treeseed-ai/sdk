import { describe, expect, it } from 'vitest';
import {
	createContentToolPresets,
	genericContentInputSchema,
	renderContentRecord,
	validateContentRecord,
	validateProposalContentForSubmission,
} from '../../../src/operations/content-operations.ts';

describe('content operations', () => {
	it('exposes exact hierarchical paths for model-aware reads', () => {
		const schema = genericContentInputSchema('read') as { properties: Record<string, unknown> };
		expect(schema.properties.path).toMatchObject({ type: 'string' });
	});
	it('advertises the TreeDX search query boundary to execution providers', () => {
		const schema = genericContentInputSchema('query') as { properties: { query: Record<string, unknown> } };
		expect(schema.properties.query).toMatchObject({ type: 'string', maxLength: 200 });
	});
	it('requires a structured non-empty relation for content link tools', () => {
		const schema = genericContentInputSchema('link') as {
			required: string[];
			properties: { relations: { minItems: number; items: { required: string[]; additionalProperties: boolean } } };
		};
		expect(schema.required).toEqual(['model', 'relations']);
		expect(schema.properties.relations).toMatchObject({
			minItems: 1,
			items: { required: ['field', 'targetSlug'], additionalProperties: false },
		});
	});

	it('generates model-specific presets from content-backed models', () => {
		const ids = createContentToolPresets().map((preset) => preset.id);
		expect(ids).toContain('treeseed.questions.create');
		expect(ids).toContain('treeseed.proposals.create');
		expect(ids).toContain('treeseed.notes.create');
		expect(ids).toContain('treeseed.discussion_messages.create');
		expect(ids).not.toContain('treeseed.discussion-messages.create');
		expect(ids).toContain('treeseed.books.add_knowledge');
		expect(ids).toContain('treeseed.content.link_note');
	});

	it('renders canonical content with SDK field aliases', () => {
		const record = renderContentRecord({
			model: 'question',
			title: 'How should agent content tools work?',
			fields: {
				questionType: 'implementation',
				relatedObjectives: ['agent-tooling'],
			},
			body: 'Use model-aware commands.',
		});

		expect(record.path).toBe('src/content/questions/how-should-agent-content-tools-work.mdx');
		expect(record.frontmatter).toMatchObject({
			title: 'How should agent content tools work?',
			question_type: 'implementation',
			related_objectives: ['agent-tooling'],
		});
		expect(record.content).toContain('Use model-aware commands.');
		expect(record.ref).toMatchObject({ subjectId: 'agent-tooling', subjectField: 'related_objectives' });
	});

	it('validates complete model frontmatter through portable Zod schemas', () => {
		const record = renderContentRecord({
			model: 'note',
			title: 'Linked observation',
			fields: {
				description: 'A durable linked observation.',
				date: '2026-08-12',
				status: 'planned',
				author: 'self-hosting-architect',
				summary: 'The content path is validated before commit.',
			},
			body: 'A note body.',
		});

		expect(validateContentRecord('note', record.content)).toMatchObject({ ok: true });
		expect(validateContentRecord('note', '---\nstatus: planned\n---\nBody')).toMatchObject({ ok: false });
	});

	it('reports collection-compatible Zod diagnostics for invalid proposal type identifiers', () => {
		const record = renderContentRecord({
			model: 'proposal', title: 'Invalid proposal classification',
			fields: {
				description: 'Exercises the shared proposal validator.', date: '2026-08-12', status: 'planned',
				summary: 'Invalid classifications fail before TreeDX commit.', proposalType: 'Not Portable!',
				motivation: 'Prevent delayed Astro collection failures.', primaryContributor: 'self-hosting-architect',
			},
		});
		const validation = validateContentRecord('proposal', record.content);
		expect(validation.ok).toBe(false);
		expect(validation.diagnostics).toContainEqual(expect.objectContaining({
			code: 'content_zod_invalid_string', field: 'proposal_type',
		}));
	});

	it('passes the canonical singular proposal type into governance readiness', () => {
		const record = renderContentRecord({
			model: 'proposal', title: 'Complete governed implementation proposal',
			fields: {
				description: 'A complete proposal that exercises the shared readiness boundary.', date: '2026-08-12', status: 'planned',
				summary: 'This proposal contains enough structured context for independent governance review.', proposalType: 'implementation',
				motivation: 'Keep model validation and proposal readiness on one canonical field contract.', primaryContributor: 'self-hosting-architect',
				relatedObjectives: ['objective:core'], evidenceRefs: ['note:validation-evidence'],
				plan: {
					desiredOutcome: 'Give agents one validated proposal contract that produces actionable feedback before mutation.',
					currentProblem: 'The Zod boundary accepted proposal_type while readiness silently ignored the same canonical field.',
					proposedApproach: 'Normalize the singular content-model field into the proposalTypes readiness input at the boundary.',
					scope: ['SDK proposal validation'], nonGoals: ['Automatic approval'], deliverables: ['Canonical readiness mapping'],
					acceptanceCriteria: ['A complete rendered proposal passes submission validation'], risks: ['Schema drift'], dependencies: ['Zod model validation'],
					alternatives: ['Duplicate the proposal type in content'], verification: ['Run the SDK content integration suite'], openQuestions: [],
				},
			},
			body: 'Validate the model-aware proposal before TreeDX mutation, preserve the canonical proposal_type field, and give the agent one coherent set of diagnostics. This keeps chat repair deterministic and prevents a valid Zod record from failing because a downstream readiness helper expected an unrelated plural shape.',
		});
		expect(validateProposalContentForSubmission(record.content)).toMatchObject({ ok: true, readiness: { contentReady: true } });
	});

	it('renders package content beneath its configured repository-relative root', () => {
		const record = renderContentRecord({
			model: 'note',
			title: 'Package planning note',
			contentRoot: 'docs/src/content',
		});
		expect(record.path).toBe('docs/src/content/notes/package-planning-note.mdx');
	});

	it('preserves an exact repository-relative knowledge placement and extension', () => {
		const record = renderContentRecord({
			model: 'knowledge',
			title: 'Agent Lab Guide Writing',
			fields: {
				schemaVersion: 'treeseed.knowledge-page/v1', bookId: 'treeseed-guide',
				summary: 'A validated Guide page.', status: 'draft', visibility: 'public',
			},
			contentRoot: 'src/content',
			placement: { path: 'src/content/knowledge/treeseed-guide/foundation/agent-lab-guide-writing.mdx' },
		});
		expect(record.path).toBe('src/content/knowledge/treeseed-guide/foundation/agent-lab-guide-writing.mdx');
		expect(validateContentRecord('knowledge', record.content)).toMatchObject({ ok: true });
		expect(record.frontmatter).toMatchObject({
			schemaVersion: 'treeseed.knowledge-page/v1', bookId: 'treeseed-guide',
			summary: 'A validated Guide page.', status: 'draft', visibility: 'public',
		});
	});

	it('preserves existing linked frontmatter and body during partial updates', () => {
		const existing = renderContentRecord({
			model: 'note',
			title: 'Linked observation',
			fields: { relatedObjectives: ['core'], author: 'tester' },
			body: 'Existing body.',
		});
		const updated = renderContentRecord({
			model: 'note',
			title: 'Linked observation',
			existingContent: existing.content,
			fields: { status: 'reviewed' },
		});

		expect(updated.frontmatter).toMatchObject({
			related_objectives: ['core'],
			author: 'tester',
			status: 'reviewed',
		});
		expect(updated.body).toBe('Existing body.');
		expect(updated.ref).toMatchObject({ subjectId: 'core', subjectField: 'related_objectives' });
	});

	it('adds a relation without replacing existing linked content', () => {
		const existing = renderContentRecord({
			model: 'note',
			title: 'Linked observation',
			fields: { author: 'tester' },
			body: 'Existing body.',
		});
		const linked = renderContentRecord({
			model: 'note',
			title: 'Linked observation',
			existingContent: existing.content,
			relations: [{ field: 'related_objectives', targetModel: 'objective', targetSlug: 'core' }],
		});

		expect(linked.frontmatter).toMatchObject({ author: 'tester', related_objectives: ['core'] });
		expect(linked.body).toBe('Existing body.');
		expect(linked.ref).toMatchObject({ subjectId: 'core', subjectField: 'related_objectives' });
	});

	it('reports the explicitly requested relation when existing content has another subject edge', () => {
		const existing = renderContentRecord({
			model: 'note',
			title: 'Editorial review',
			fields: { about: ['guide.overview'] },
			body: 'Existing review.',
		});
		const linked = renderContentRecord({
			model: 'note',
			title: 'Editorial review',
			existingContent: existing.content,
			relations: [{ field: 'relatedObjectives', targetModel: 'objective', targetSlug: 'objective:core' }],
		});

		expect(linked.frontmatter).toMatchObject({ about: ['guide.overview'], relatedObjectives: ['objective:core'] });
		expect(linked.ref).toMatchObject({ subjectId: 'objective:core', subjectField: 'relatedObjectives' });
	});

	it('renders and validates assignment operational content without dropping plan fields', () => {
		const record = renderContentRecord({
			model: 'assignment_plan', id: 'assignment-a', title: 'Plan for assignment-a',
			fields: {
				status: 'active', revision: 1, teamId: 'team-a', projectId: 'project-a',
				workdayId: 'workday-a', assignmentId: 'assignment-a', objective: 'Produce the governed Guide artifact.',
				createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
				completed: [], remaining: [{ id: 'write', title: 'Write', description: 'Write and validate the Guide page.' }], risks: [],
			},
		});

		expect(record.path).toBe('src/content/assignment-plans/plan-for-assignment-a.mdx');
		expect(record.frontmatter).toMatchObject({
			id: 'assignment-a', assignmentId: 'assignment-a', revision: 1,
			objective: 'Produce the governed Guide artifact.',
			remaining: [{ id: 'write', title: 'Write', description: 'Write and validate the Guide page.' }],
		});
		expect(validateContentRecord('assignment_plan', record.content)).toMatchObject({ ok: true });
	});
});
