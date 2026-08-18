import { buildBuiltinModelRegistry,resolveModelDefinition } from '../../entrypoints/models/model-registry.ts';
import { normalizeRecordToCanonicalShape } from '../../entrypoints/models/sdk-fields.ts';
import type { SdkModelRegistry } from '../../entrypoints/models/sdk-types.ts';
import { isPortableContentModel,validateContentFrontmatter,type PortableContentModel } from './content-model-schemas.ts';

const registryIndependentModels = new Set<PortableContentModel>([
	'agent_test', 'workday', 'template_product',
	'agent_context_query', 'agent_context_query_set', 'agent_instruction_template', 'discussion_topic',
	'assignment_plan', 'assignment_status', 'assignment_summary', 'agent_evaluation',
]);

export interface PortableContentDiagnostic {
	path?: string;
	model: PortableContentModel;
	field?: string;
	code: string;
	message: string;
}

export class PortableContentValidationError extends Error {
	readonly code = 'content_model_invalid';
	constructor(readonly details: PortableContentDiagnostic[]) {
		super(`Content failed model validation with ${details.length} field error${details.length === 1 ? '' : 's'}.`);
		this.name = 'PortableContentValidationError';
	}
}

export function validatePortableContentData(model: string, value: unknown, registry: SdkModelRegistry = buildBuiltinModelRegistry()) {
	if (!isPortableContentModel(model)) return { ok: true, data: value, diagnostics: [], portable: false as const };
	if (registryIndependentModels.has(model)) return { ...validateContentFrontmatter(model, value), portable: true as const };
	const definition = resolveModelDefinition(model, registry);
	const frontmatter = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
	const canonical = definition.name === 'agent' ? frontmatter : normalizeRecordToCanonicalShape(definition, frontmatter);
	return { ...validateContentFrontmatter(model, canonical), portable: true as const };
}

export function assertPortableContentData(model: PortableContentModel,value: unknown,input: { path?: string; registry?: SdkModelRegistry } = {}) {
	const result = validatePortableContentData(model,value,input.registry);
	if (!result.ok) throw new PortableContentValidationError(result.diagnostics.map((diagnostic) => ({
		...(input.path ? { path: input.path } : {}),model,field:diagnostic.field,code:diagnostic.code,message:diagnostic.message,
	})));
	return result.data;
}
