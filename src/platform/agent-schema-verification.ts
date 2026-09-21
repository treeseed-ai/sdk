import type { PlatformDiagnostic } from './schemas.ts';
import { describeContentFrontmatterSchema } from '../content/validation/content-model-schemas.ts';

const models = {
	Book: 'book', Knowledge: 'knowledge', Objective: 'objective',
	Discussion: 'discussion', DiscussionMessage: 'discussion_message',
} as const;

type Field = { isOptional(): boolean; safeParse(value: unknown): { success: boolean } };

/** Compare the authored architecture declaration with its executable content validators. */
export function verifyAgentContentSchema(document: unknown, path = 'docs/agent.schema.yml'): PlatformDiagnostic[] {
	const definitions = (document as { $defs?: Record<string, unknown> })?.$defs ?? {};
	const diagnostics: PlatformDiagnostic[] = [];
	for (const [definition, model] of Object.entries(models)) {
		const declared = definitions[definition] as { properties?: Record<string, { const?: unknown }>; required?: string[] } | undefined;
		const schema = describeContentFrontmatterSchema(model);
		const shape = 'shape' in schema ? schema.shape as Record<string, Field> : {};
		if (!declared?.properties || !Array.isArray(declared.required)) {
			diagnostics.push({ code: 'agent_schema_missing', path, message: `${definition} must declare properties and required fields.` });
			continue;
		}
		const declaredKeys = Object.keys(declared.properties).sort();
		const actualKeys = Object.keys(shape).sort();
		const missing = actualKeys.filter((key) => !declaredKeys.includes(key));
		const extra = declaredKeys.filter((key) => !actualKeys.includes(key));
		if (missing.length || extra.length) diagnostics.push({ code: 'agent_schema_fields_mismatch', path,
			message: `${definition} differs from SDK ${model} fields; missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}.` });
		const required = actualKeys.filter((key) => !shape[key]!.isOptional()).sort();
		const declaredRequired = [...declared.required].sort();
		if (JSON.stringify(required) !== JSON.stringify(declaredRequired)) diagnostics.push({ code: 'agent_schema_required_mismatch', path,
			message: `${definition} required fields differ; SDK: ${required.join(', ') || 'none'}; declaration: ${declaredRequired.join(', ') || 'none'}.` });
		for (const [field, specification] of Object.entries(declared.properties)) {
			if (specification && Object.hasOwn(specification, 'const') && shape[field]
				&& !shape[field].safeParse(specification.const).success) diagnostics.push({ code: 'agent_schema_constant_mismatch', path,
					message: `${definition}.${field} constant is rejected by the SDK validator.` });
		}
	}
	return diagnostics;
}
