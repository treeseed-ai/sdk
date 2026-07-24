export interface ResearchSourcePolicy {
	schemaVersion: 1;
	allowedDomains: string[];
	requestTimeoutMs: number;
	maxResponseBytes: number;
	maxRedirects: number;
	allowedContentTypes: string[];
}
