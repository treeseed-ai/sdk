import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface ParsedMarkdownDocument {
	frontmatter: Record<string, unknown>;
	body: string;
}

export function parseFrontmatterDocument(source: string): ParsedMarkdownDocument {
	if (!source.startsWith('---\n')) {
		return {
			frontmatter: {},
			body: source,
		};
	}

	const delimiterIndex = source.indexOf('\n---\n', 4);
	if (delimiterIndex < 0) {
		return {
			frontmatter: {},
			body: source,
		};
	}

	const yamlSource = source.slice(4, delimiterIndex);
	const body = source.slice(delimiterIndex + 5);
	const parsed = parseYaml(yamlSource);

	return {
		frontmatter:
			parsed && typeof parsed === 'object' && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: {},
		body,
	};
}

export function serializeFrontmatterDocument(
	frontmatter: Record<string, unknown>,
	body: string,
) {
	return `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n${body.replace(/^\n*/, '')}`;
}
