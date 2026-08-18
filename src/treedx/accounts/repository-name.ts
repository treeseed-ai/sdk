export function normalizeRepositoryName(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_.-]+/gu, '-')
		.replace(/^-+|-+$/gu, '') || 'project';
}

export function projectRepositoryName(projectSlug: string): string {
	return normalizeRepositoryName(`treeseed-${projectSlug}`);
}
