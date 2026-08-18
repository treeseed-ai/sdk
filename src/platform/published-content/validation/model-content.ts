import { parseFrontmatterDocument } from '../../../content/frontmatter.ts';
import { validateContentFrontmatter, type PortableContentModel } from '../../../content/validation/content-model-schemas.ts';
import { validateContentRecord, type ContentModel } from '../../../operations/content-operations.ts';

export interface PublicationContentSource { path: string; body: string }
export interface PublicationContentDiagnostic {
	path: string;
	model: PortableContentModel;
	field?: string;
	code: string;
	message: string;
}

const collectionModels: Record<string, PortableContentModel> = {
	pages: 'page', notes: 'note', questions: 'question', objectives: 'objective', proposals: 'proposal', decisions: 'decision',
	books: 'book', knowledge: 'knowledge', docs: 'knowledge', people: 'person', agents: 'agent', groups: 'group',
	'group-edges': 'group_edge', discussions: 'discussion', 'discussion-messages': 'discussion_message',
	'discussion-events': 'discussion_event', 'agent-tests': 'agent_test', workdays: 'workday', templates: 'template_product',
};
const operationModels = new Set<PortableContentModel>([
	'page', 'note', 'question', 'objective', 'proposal', 'decision', 'book', 'knowledge', 'person', 'agent',
	'discussion', 'discussion_message', 'discussion_event', 'group', 'group_edge',
]);

export class ContentPublicationValidationError extends Error {
	readonly code = 'content_publication_model_invalid';
	constructor(readonly details: PublicationContentDiagnostic[]) {
		super(`Content publication failed model validation with ${details.length} field error${details.length === 1 ? '' : 's'}.`);
		this.name = 'ContentPublicationValidationError';
	}
}

export function validatePublicationContent(sources: PublicationContentSource[]) {
	const diagnostics: PublicationContentDiagnostic[] = [];
	let validatedFileCount = 0;
	for (const source of sources) {
		if (!/\.mdx?$/iu.test(source.path)) continue;
		const collection = source.path.replaceAll('\\', '/').split('/')[0] ?? '';
		const model = collectionModels[collection];
		if (!model) continue;
		validatedFileCount += 1;
		try {
			const result = operationModels.has(model)
				? validateContentRecord(model as ContentModel, source.body)
				: validateContentFrontmatter(model, parseFrontmatterDocument(source.body).frontmatter);
			for (const issue of result.diagnostics) diagnostics.push({
				path: source.path, model, field: issue.field, code: issue.code, message: issue.message,
			});
		} catch (error) {
			diagnostics.push({ path: source.path, model, field: 'frontmatter', code: 'content_frontmatter_invalid',
				message: error instanceof Error ? error.message : 'Content frontmatter is invalid.' });
		}
	}
	if (diagnostics.length) throw new ContentPublicationValidationError(diagnostics);
	return { validatedFileCount, diagnostics: [] as PublicationContentDiagnostic[] };
}
