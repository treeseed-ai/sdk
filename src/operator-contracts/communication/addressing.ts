export type CommunicationAddressRequirement = 'required' | 'optional';

export interface CommunicationAddress {
	projectSlug: string | null;
	agentSlug: string;
	requirement: CommunicationAddressRequirement;
	address: string;
}

const ADDRESS = /(^|[^\p{L}\p{N}._%+-])@([a-z0-9][a-z0-9-]*)(?:\/([a-z0-9][a-z0-9-]*))?/giu;

function visibleMarkdown(markdown: string) {
	const lines = markdown.replace(/\r\n?/gu, '\n').split('\n');
	let fenced = false;
	return lines.map((line) => {
		if (/^\s*```/u.test(line)) { fenced = !fenced; return ''; }
		if (fenced || /^\s*>/u.test(line)) return '';
		return line
			.replace(/`[^`]*`/gu, '')
			.replace(/!?\[[^\]]*\]\([^)]*\)/gu, '')
			.replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/giu, '');
	}).join('\n');
}

function initialAddressLines(markdown: string) {
	const lines = visibleMarkdown(markdown).split('\n');
	let started = false; const requiredThrough = new Map<number, number>();
	for (let index = 0; index < lines.length; index += 1) {
		const source = lines[index]!; const line = source.trim();
		if (!line && !started) continue;
		if (!line) break;
		started = true;
		const leading = source.match(/^\s*(?:@[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)?[\s,;:—–-]*)+/iu);
		if (!leading) break;
		requiredThrough.set(index, leading[0].length);
		if (source.slice(leading[0].length).trim()) break;
	}
	return { markdown: visibleMarkdown(markdown), requiredThrough };
}

export function parseCommunicationAddresses(markdown: string): CommunicationAddress[] {
	const visible = initialAddressLines(markdown);
	const addresses = new Map<string, CommunicationAddress>();
	for (const [lineIndex, line] of visible.markdown.split('\n').entries()) {
		ADDRESS.lastIndex = 0;
		for (const match of line.matchAll(ADDRESS)) {
			const first = match[2]!.toLowerCase();
			const second = match[3]?.toLowerCase() ?? null;
			const projectSlug = second ? first : null;
			const agentSlug = second ?? first;
			const key = `${projectSlug ?? ''}/${agentSlug}`;
			const addressIndex = (match.index ?? 0) + match[1]!.length;
			const requirement = addressIndex < (visible.requiredThrough.get(lineIndex) ?? 0) ? 'required' : 'optional';
			const existing = addresses.get(key);
			if (!existing || requirement === 'required') addresses.set(key, {
				projectSlug, agentSlug, requirement, address: `@${projectSlug ? `${projectSlug}/` : ''}${agentSlug}`,
			});
		}
	}
	return [...addresses.values()];
}
