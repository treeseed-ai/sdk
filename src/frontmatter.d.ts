export interface ParsedMarkdownDocument {
    frontmatter: Record<string, unknown>;
    body: string;
}
export declare function parseFrontmatterDocument(source: string): ParsedMarkdownDocument;
export declare function serializeFrontmatterDocument(frontmatter: Record<string, unknown>, body: string): string;
