import { describe, expect, it } from 'vitest';
import { verifyAgentContentSchema } from '../../../../src/platform/agent-schema-verification.ts';
import { definition, partialSdkDocument } from './schema-verification-fixture.ts';
import { canonicalAuthority, schemaRecord, assertCanonicalAuthorityUnchanged } from './canonical-schema-fixture.ts';
import { afterAll } from 'vitest';
import { graphChangeSetSchema, appliedWorkdaySchema, exactEntityReferenceSchema } from '../../../../src/capacity/agents/agent-capacity.ts';

afterAll(assertCanonicalAuthorityUnchanged);

describe('Platform agent content schema verification', () => {
	it('recognizes only exact finite enum unions including nullable pair roles while retaining changed overlapping and qualified scalar denials', () => {
		const { document } = canonicalAuthority(), held = structuredClone(document);
		const choices = ['general', 'feedback', 'research', 'workday-report'];
		const originalNodes = verifyAgentContentSchema(document).filter(entry => entry.message.startsWith('ExecutionNode '));
		for (const keyword of ['anyOf', 'oneOf'] as const) {
			const changed = structuredClone(document);
			schemaRecord(schemaRecord(changed.$defs.Note).properties).classification = { [keyword]: choices.map(value => ({ const: value })).reverse() };
			schemaRecord(schemaRecord(changed.$defs.ExecutionNode).properties).pairRole = { [keyword]: [{ enum: ['reviewer', 'actor'] }, { type: 'null' }] };
			const before = structuredClone(changed), result = verifyAgentContentSchema(changed);
			expect(result.filter(entry => entry.message.startsWith('Note '))).toEqual([]);
			expect(result.filter(entry => entry.message.startsWith('ExecutionNode '))).toEqual(originalNodes);
			expect(changed).toEqual(before);
		}
		const invalid = [
			{ anyOf: choices.slice(1).map(value => ({ const: value })) },
			{ anyOf: [...choices.map(value => ({ const: value })), { const: 'foreign' }] },
			{ anyOf: [...choices.map(value => ({ const: value })), { type: 'null' }] },
			{ oneOf: [...choices.map(value => ({ const: value })), { const: 'general' }] },
			{ oneOf: [{ enum: choices }, { type: 'string' }] },
			{ anyOf: [{ enum: choices, maxLength: 6 }] },
			{ anyOf: [] },
		];
		for (const field of invalid) {
			const changed = structuredClone(document); schemaRecord(schemaRecord(changed.$defs.Note).properties).classification = field;
			const before = structuredClone(changed);
			expect(verifyAgentContentSchema(changed)).toContainEqual(expect.objectContaining({ code: 'agent_schema_structure_mismatch',
				message: expect.stringContaining('Note nested declarative constraints differ') }));
			expect(changed).toEqual(before);
		}
		expect(document).toEqual(held);
	});
	it('recognizes only redundant object kinds under established object authority while retaining contradictory branch and nested field assertions', () => {
		const { document } = canonicalAuthority(), held = structuredClone(document);
		const original = verifyAgentContentSchema(document).filter(entry => entry.message.startsWith('ExactEntityReference '));
		expect(original).toEqual([]);
		const changed = structuredClone(document), constraints = schemaRecord(changed.$defs.ExactEntityReference).allOf;
		if (!Array.isArray(constraints)) throw new Error('Canonical object conditional constraints required.');
		for (const entry of constraints) {
			delete schemaRecord(schemaRecord(entry).if).type; delete schemaRecord(schemaRecord(entry).then).type;
			const alternatives = schemaRecord(schemaRecord(entry).then).anyOf;
			if (Array.isArray(alternatives)) for (const alternative of alternatives) delete schemaRecord(alternative).type;
		}
		const before = structuredClone(changed);
		expect(verifyAgentContentSchema(changed).filter(entry => entry.message.startsWith('ExactEntityReference '))).toEqual([]);
		expect(changed).toEqual(before);
		for (const variant of ['contradictory-kind', 'nested-field-kind'] as const) {
			const denied = structuredClone(document), definition = schemaRecord(denied.$defs.ExactEntityReference);
			if (variant === 'contradictory-kind') {
				if (!Array.isArray(definition.allOf)) throw new Error('Object conditional required.');
				schemaRecord(schemaRecord(definition.allOf[0]).then).type = 'string';
			} else schemaRecord(schemaRecord(definition.properties).model).type = 'number';
			const bytes = structuredClone(denied);
			expect(verifyAgentContentSchema(denied)).toContainEqual(expect.objectContaining({ code: 'agent_schema_structure_mismatch',
				message: expect.stringContaining('ExactEntityReference nested declarative constraints differ') }));
			expect(denied).toEqual(bytes);
		}
		expect(document).toEqual(held);
	});
	it('exports exact assignment identifier inventories and unique graph revision source authority from the same executable validators', () => {
		const { document } = canonicalAuthority(), held = structuredClone(document);
		const names = ['AssignmentAttempt', 'AssignmentContext', 'GraphRevision'];
		const diagnostics = verifyAgentContentSchema(document);
		expect(names.map(name => ({ name, diagnostics: diagnostics.filter(entry => entry.message.startsWith(`${name} `)) })))
			.toEqual(names.map(name => ({ name, diagnostics: [] })));
		for (const field of ['requiredCapabilities', 'predecessorResultIds']) {
			const changed = structuredClone(document);
			delete schemaRecord(schemaRecord(schemaRecord(changed.$defs.AssignmentAttempt).properties)[field]).uniqueItems;
			expect(verifyAgentContentSchema(changed)).toContainEqual(expect.objectContaining({ code: 'agent_schema_structure_mismatch',
				message: expect.stringContaining('AssignmentAttempt nested declarative constraints differ') }));
		}
		const changed = structuredClone(document);
		delete schemaRecord(schemaRecord(schemaRecord(changed.$defs.GraphRevision).properties).changedSourceRefs).uniqueItems;
		expect(verifyAgentContentSchema(changed)).toContainEqual(expect.objectContaining({ code: 'agent_schema_structure_mismatch',
			message: expect.stringContaining('GraphRevision nested declarative constraints differ') }));
		expect(document).toEqual(held);
	});
	it('compares only provably disjoint tagged union and singleton enum semantics while retaining overlapping missing-tag and branch-bound denials', () => {
		const { document } = canonicalAuthority(), held = structuredClone(document);
		const names = ['AssignmentWorkspace', 'AssignmentReference', 'ReadOnlyWorkspace'];
		const observed = [document, structuredClone(document)];
		for (const name of ['AssignmentWorkspace', 'AssignmentReference']) {
			const union = schemaRecord(observed[1]!.$defs[name]);
			if (!Array.isArray(union.oneOf)) throw new Error('Canonical tagged union required.');
			union.anyOf = [...union.oneOf].reverse(); delete union.oneOf;
		}
		const tag = schemaRecord(schemaRecord(schemaRecord(observed[1]!.$defs.ReadOnlyWorkspace).properties).mode);
		tag.enum = [tag.const]; delete tag.const;
		const positives = observed.map(input => { const before = structuredClone(input), result = verifyAgentContentSchema(input);
			expect(input).toEqual(before); return names.map(name => result.filter(entry => entry.message.startsWith(`${name} `))); });
		for (const result of positives) expect(result).toEqual(names.map(() => []));
		for (const mutation of ['duplicate-branch', 'missing-tag', 'shared-tag', 'missing-required-tag', 'removed-bound', 'overlapping-scalar'] as const) {
			const changed = structuredClone(document), workspace = schemaRecord(changed.$defs.AssignmentWorkspace);
			if (mutation === 'duplicate-branch') { if (!Array.isArray(workspace.oneOf)) throw new Error('Union required'); workspace.oneOf.push(workspace.oneOf[0]); }
			else if (mutation === 'overlapping-scalar') schemaRecord(schemaRecord(changed.$defs.Book).properties).title = { oneOf: [{ type: 'string', minLength: 1 }, { type: 'string', minLength: 1 }] };
			else if (mutation === 'removed-bound') delete schemaRecord(schemaRecord(schemaRecord(changed.$defs.GitAssignmentWorkspace).properties).branch).minLength;
			else { const branch = schemaRecord(changed.$defs.ReadOnlyWorkspace), properties = schemaRecord(branch.properties);
				if (mutation === 'missing-tag') delete schemaRecord(properties.mode).const;
				else if (mutation === 'shared-tag') schemaRecord(properties.mode).const = 'git';
				else branch.required = []; }
			const before = structuredClone(changed), expected = mutation === 'overlapping-scalar' ? 'Book' : 'AssignmentWorkspace';
			expect(verifyAgentContentSchema(changed)).toContainEqual(expect.objectContaining({ code: 'agent_schema_structure_mismatch', message: expect.stringContaining(`${expected} nested declarative constraints differ`) }));
			expect(changed).toEqual(before);
		}
		expect(document).toEqual(held);
	});
	it('binds canonical accounting identifiers and writable path bounds to their owning executable schemas without pipe-only or hidden refinement constraints', () => {
		const { document } = canonicalAuthority(), held = structuredClone(document);
		const names = ['Lease', 'Reservation', 'UsageSettlement', 'TreeDxAssignmentWorkspace', 'GitAssignmentWorkspace'];
		const diagnostics = verifyAgentContentSchema(document);
		expect(names.map(name => ({ name, diagnostics: diagnostics.filter(entry => entry.message.startsWith(`${name} `)) })))
			.toEqual(names.map(name => ({ name, diagnostics: [] })));
		for (const name of ['TreeDxAssignmentWorkspace', 'GitAssignmentWorkspace']) {
			const changed = structuredClone(document);
			delete schemaRecord(schemaRecord(schemaRecord(changed.$defs[name]).properties).writablePaths).minItems;
			const before = structuredClone(changed);
			expect(verifyAgentContentSchema(changed)).toContainEqual(expect.objectContaining({ code: 'agent_schema_structure_mismatch',
				message: expect.stringContaining(`${name} nested declarative constraints differ`) }));
			expect(changed).toEqual(before);
		}
		expect(document).toEqual(held);
	});
	it('exports the same store-specific exact reference requirements enforced by the owning validator without borrowing declaration constraints', () => {
		const { document } = canonicalAuthority(), held = structuredClone(document);
		const base = { model: 'evidence', id: 'evidence' }, commit = 'a'.repeat(40), digest = `sha256:${'b'.repeat(64)}`;
		const valid = [{ ...base, store: 'postgresql' }, { ...base, store: 'git', repository: 'source', commit },
			{ ...base, store: 'treedx', commit }, { ...base, store: 'treedx', revision: 1, digest },
			{ ...base, store: 'url', url: 'https://example.test/evidence' }, { ...base, store: 'postgresql', startLine: 1, endLine: 1 }];
		const invalid = [{ ...base, store: 'git', repository: 'source' }, { ...base, store: 'git', commit },
			{ ...base, store: 'treedx' }, { ...base, store: 'treedx', revision: 1 }, { ...base, store: 'treedx', digest },
			{ ...base, store: 'url' }, { ...base, store: 'postgresql', endLine: 1 }];
		for (const input of valid) expect(exactEntityReferenceSchema.parse(input)).toEqual(input);
		for (const input of invalid) expect(exactEntityReferenceSchema.safeParse(input).success).toBe(false);
		expect(verifyAgentContentSchema(document).filter(entry => entry.message.startsWith('ExactEntityReference '))).toEqual([]);
		const constraints = schemaRecord(document.$defs.ExactEntityReference).allOf;
		if (!Array.isArray(constraints)) throw new Error('Exact reference conditional authority required.');
		for (let index = 0; index < constraints.length; index++) {
			const changed = structuredClone(document);
			schemaRecord(changed.$defs.ExactEntityReference).allOf = constraints.filter((_, position) => position !== index);
			const supplied = structuredClone(changed);
			expect(verifyAgentContentSchema(changed)).toContainEqual(expect.objectContaining({ code: 'agent_schema_structure_mismatch',
				message: expect.stringContaining('ExactEntityReference nested declarative constraints differ') }));
			expect(changed).toEqual(supplied);
		}
		expect(document).toEqual(held);
	});
	it('resolves exact nested escaped local schema references and rejects missing external or cyclic references without changing supplied authority', () => {
		const document = partialSdkDocument(), original = structuredClone(definition(document, 'Book').properties.title!);
		document.$defs['reference~/namespace'] = { properties: { title: original,
			alias: { $ref: '#/$defs/reference~0~1namespace/properties/title' } }, required: [] };
		const baseline = verifyAgentContentSchema(document);
		expect(baseline.filter(entry => entry.message.startsWith('Book '))).toEqual([]);
		for (const reference of ['#/$defs/reference~0~1namespace/properties/title', '#/$defs/reference~0~1namespace/properties/alias']) {
			const supplied = structuredClone(document); definition(supplied, 'Book').properties.title = { $ref: reference };
			const held = structuredClone(supplied); expect(verifyAgentContentSchema(supplied)).toEqual(baseline); expect(supplied).toEqual(held);
		}
		for (const reference of ['#/$defs/reference~0~1namespace/properties/absent', 'https://example.test/schema', '#/$defs/Book/properties/title']) {
			const supplied = structuredClone(document); definition(supplied, 'Book').properties.title = { $ref: reference };
			const held = structuredClone(supplied);
			expect(verifyAgentContentSchema(supplied)).toContainEqual(expect.objectContaining({ code: 'agent_schema_structure_mismatch',
				message: expect.stringContaining('Book nested declarative constraints differ') }));
			expect(supplied).toEqual(held);
		}
	});
	it('binds graph change and planning identity uniqueness to the same executable validators and detects removed declaration rules', () => {
		const { document } = canonicalAuthority(), held = structuredClone(document);
		for (const name of ['GraphChangeSet', 'PlanningRound']) {
			const diagnostics = verifyAgentContentSchema(document).filter(entry => entry.message.startsWith(`${name} `));
			expect(diagnostics, name).toEqual([]);
			const properties = schemaRecord(schemaRecord(document.$defs[name]).properties);
			for (const [field, value] of Object.entries(properties)) if (schemaRecord(value).uniqueItems === true) {
				const changed = structuredClone(document);
				delete schemaRecord(schemaRecord(schemaRecord(changed.$defs[name]).properties)[field]).uniqueItems;
				const before = structuredClone(changed);
				expect(verifyAgentContentSchema(changed)).toContainEqual(expect.objectContaining({
					code: 'agent_schema_structure_mismatch', message: expect.stringContaining(`${name} nested declarative constraints differ`) }));
				expect(changed).toEqual(before);
			}
		}
		const original = { added: ['one', 'two'], changed: [], completed: [], blocked: [], stale: [], removedEdges: [], addedEdges: [] };
		expect(graphChangeSetSchema.parse(original)).toEqual(original);
		for (const field of Object.keys(original)) expect(graphChangeSetSchema.safeParse({ ...original, [field]: ['one', 'one'] }).success).toBe(false);
		const round = appliedWorkdaySchema.innerType().shape.planningRounds.element;
		expect(round.parse({ round: 1, state: 'active', assignmentIds: ['one', 'two'] })).toEqual({ round: 1, state: 'active', assignmentIds: ['one', 'two'] });
		expect(round.safeParse({ round: 1, state: 'active', assignmentIds: ['one', 'one'] }).success).toBe(false);
		expect(document).toEqual(held);
	});
	it('rejects an implementation-generated five-model subset as complete canonical authority', () => {
		expect(verifyAgentContentSchema(partialSdkDocument())).not.toEqual([]);
	});
	it('detects drift in fields, required fields, and constants', () => {
		const document = partialSdkDocument();
		delete definition(document, 'Book').properties.revision;
		definition(document, 'Knowledge').required = [];
		definition(document, 'Book').properties.schemaVersion = { const: 'treeseed.book/v99' };
		expect(verifyAgentContentSchema(document).map((entry) => entry.code)).toEqual(expect.arrayContaining([
			'agent_schema_fields_mismatch', 'agent_schema_required_mismatch', 'agent_schema_constant_mismatch',
		]));
	});
	it('detects nested declarative constraint drift', () => {
		const document = partialSdkDocument();
		const reference = definition(document, 'Knowledge').properties.bookRef!.properties as Record<string, Record<string, unknown>>;
		reference.commit!.pattern = '^wrong$';
		expect(verifyAgentContentSchema(document).map((entry) => entry.code)).toContain('agent_schema_structure_mismatch');
	});
	it('reports unresolved stored and runtime model references instead of skipping the root union', () => {
		const names = ['AgentProfile', 'Proposal', 'Decision', 'ExecutionNode', 'Workday',
			'AssignmentAttempt', 'AssignmentContext', 'AssignmentResult', 'UsageSettlement'];
		const observed = names.map(name => {
			const document = partialSdkDocument();
			document.oneOf = [{ $ref: `#/$defs/${name}` }];
			return { name, diagnosed: verifyAgentContentSchema(document).some(entry => entry.message.includes(name)) };
		});
		expect(observed).toEqual(names.map(name => ({ name, diagnosed: true })));
	});
	it('detects union and exclusion constraints rather than discarding declaration semantics', () => {
		const variants = [{ anyOf: [{ const: 'only-authorized-title' }] }, { not: { const: 'blocked-title' } }];
		const observed = variants.map(constraint => {
			const document = partialSdkDocument();
			Object.assign(definition(document, 'Book').properties.title!, constraint);
			return verifyAgentContentSchema(document).some(entry => entry.code === 'agent_schema_structure_mismatch'
				&& entry.message.includes('Book'));
		});
		expect(observed).toEqual([true, true]);
	});
	it('rejects unconstrained assignment authority without mutating the submitted declaration', () => {
		const document = partialSdkDocument();
		document.$defs.AssignmentAttempt = true;
		document.oneOf = [{ $ref: '#/$defs/AssignmentAttempt' }];
		const before = JSON.stringify(document);
		const observed = verifyAgentContentSchema(document);
		expect(JSON.stringify(document)).toBe(before);
		expect(observed.some(entry => entry.message.includes('AssignmentAttempt'))).toBe(true);
	});
	it('rejects malformed or moving root references before declaring equivalence', () => {
		const references = ['#/$defs/Book/absent', '#/$defs/Absent', 'https://example.test/latest/schema'];
		const observed = references.map(reference => {
			const document = partialSdkDocument();
			document.oneOf = [{ $ref: reference }];
			return verifyAgentContentSchema(document, 'docs/agent.schema.yml');
		});
		for (const diagnostics of observed) {
			expect(diagnostics).not.toEqual([]);
			expect(diagnostics.every(entry => entry.path === 'docs/agent.schema.yml')).toBe(true);
		}
	});
	it('rejects every retired model instead of accepting a compatibility root union', () => {
		const names = ['architecture', 'review', 'workday-report', 'assignment_plan', 'assignment_status',
			'assignment_summary', 'source-candidate', 'capacity-plan', 'demand'];
		const observed = names.map(name => {
			const document = partialSdkDocument();
			document.$defs[name] = true;
			document.oneOf = [{ $ref: `#/$defs/${name}` }];
			return verifyAgentContentSchema(document).length;
		});
		expect(observed.every(count => count > 0)).toBe(true);
	});
});
