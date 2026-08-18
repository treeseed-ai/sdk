const clean = (value: string) => value.trim().replace(/^\/+|\/+$/gu, '');

export function bookPath(teamSlug: string, bookSlug: string) {
	return `/t/${encodeURIComponent(clean(teamSlug))}/books/${encodeURIComponent(clean(bookSlug))}`;
}

export function knowledgePagePath(teamSlug: string, bookSlug: string, pageSlug: string) {
	return `${bookPath(teamSlug, bookSlug)}/${clean(pageSlug).split('/').map(encodeURIComponent).join('/')}`;
}

export function knowledgeDownloadName(bookSlug: string) {
	return `${clean(bookSlug).replace(/[^a-z0-9-]+/giu, '-').toLowerCase()}.knowledge-pack.zip`;
}
