import { describe, expect, it } from 'vitest';
import { verifyAgentContentSchema } from '../../../../src/platform/agent-schema-verification.ts';
import { definition, partialSdkDocument } from './schema-verification-fixture.ts';

describe('Platform agent content schema verification', () => {
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
