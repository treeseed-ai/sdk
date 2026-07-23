
import { CommitMessageContext, CommitMessageDependencyUpdate, CommitMessagePackageChange, CommitMessageSections, CommitMessageSubmodulePointer, allowedSectionHeadings, allowedTypes, changedPaths, compactValue, danglingSubjectEndings, forbiddenSectionHeadings, formatGroups, inferScope, inferType, lastSummaryWord, normalizeWhitespace, repairSummaryEnding, shortSha, stripControlCharacters, subjectMaxLength, summaryFromHint } from './default-commit-ai-model.ts';

export function fallbackSummary(context: CommitMessageContext, type: string, scope: string) {
	const hint = summaryFromHint(context.userMessage);
	if (hint) return repairSummaryEnding(hint);
	if ((context.packageChanges?.length ?? 0) > 0 || (context.submodulePointers?.length ?? 0) > 0) return 'sync integrated package updates';
	if ((context.dependencyUpdates?.length ?? 0) > 0) return 'sync package dependency references';
	if (context.branchMode === 'package-release-main') return 'prepare stable release';
	if (scope === 'workflow' || scope === 'save') return 'update save workflow behavior';
	if (type === 'test') return 'cover workflow behavior';
	if (type === 'docs') return 'update workflow documentation';
	if (type === 'build') return 'update package metadata';
	return 'record repository changes';
}

export function truncateSubject(type: string, scope: string, summary: string) {
	const prefix = `${type}(${scope}): `;
	const cleanSummary = repairSummaryEnding(summary);
	const maxSummaryLength = Math.max(10, subjectMaxLength - prefix.length);
	if (cleanSummary.length <= maxSummaryLength) return `${prefix}${cleanSummary}`;
	const sliced = cleanSummary.slice(0, maxSummaryLength).replace(/\s+\S*$/u, '').trim();
	const repaired = repairSummaryEnding(sliced || cleanSummary.slice(0, maxSummaryLength).trim());
	return `${prefix}${repaired}`;
}

export function wrapText(value: string, width = 72) {
	const words = normalizeWhitespace(value).split(/\s+/u).filter(Boolean);
	const lines: string[] = [];
	let line = '';
	for (const word of words) {
		if (!line) {
			line = word;
		} else if (`${line} ${word}`.length <= width) {
			line = `${line} ${word}`;
		} else {
			lines.push(line);
			line = word;
		}
	}
	if (line) lines.push(line);
	return lines;
}

export function formatBullet(text: string) {
	const lines = wrapText(text, 70);
	return lines.map((line, index) => `${index === 0 ? '-' : ' '} ${line}`).join('\n');
}

export function normalizeSectionBullets(values: string[] | undefined) {
	return (values ?? []).map((value) => normalizeWhitespace(value)).filter(Boolean);
}

export function normalizeSections(sections: CommitMessageSections | string[]) {
	if (Array.isArray(sections)) {
		return { changes: normalizeSectionBullets(sections) } satisfies CommitMessageSections;
	}
	return {
		intent: normalizeSectionBullets(sections.intent),
		changes: normalizeSectionBullets(sections.changes),
		packageChanges: normalizeSectionBullets(sections.packageChanges),
		dependencyUpdates: normalizeSectionBullets(sections.dependencyUpdates),
	} satisfies CommitMessageSections;
}

export function formatSection(heading: string, bullets: string[]) {
	if (bullets.length === 0) return null;
	return [heading, ...bullets.map(formatBullet)].join('\n');
}

export function formatCommitMessage(type: string, scope: string, summary: string, sections: CommitMessageSections | string[]) {
	const normalizedType = allowedTypes.has(type) ? type : 'chore';
	const normalizedScope = scope.toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'workflow';
	const subject = truncateSubject(normalizedType, normalizedScope, summary);
	const normalizedSections = normalizeSections(sections);
	const changes = normalizedSections.changes.length > 0
		? normalizedSections.changes
		: ['Records the staged repository changes supplied to the save workflow.'];
	const body = [
		formatSection('Intent:', normalizedSections.intent ?? []),
		formatSection('Changes:', changes),
		formatSection('Integrated package changes:', normalizedSections.packageChanges ?? []),
		formatSection('Dependency and pointer updates:', normalizedSections.dependencyUpdates ?? []),
	].filter((section): section is string => Boolean(section)).join('\n\n');
	return `${subject}\n\n${body}`;
}

export function packageChangeBullet(change: CommitMessagePackageChange) {
	const details = [
		`${change.name} ${change.path}: ${shortSha(change.oldSha)} -> ${shortSha(change.newSha)}`,
		change.tagName || change.version ? `tag ${change.tagName ?? change.version}` : null,
		change.dependencySpec ? `dependency ${compactValue(change.dependencySpec, 96)}` : null,
		change.commitSubject ? `child: ${compactValue(change.commitSubject, 96)}` : null,
	].filter(Boolean);
	return details.join(', ');
}

export function dependencyUpdateBullet(update: CommitMessageDependencyUpdate) {
	const field = update.field ? `${update.field}.` : '';
	const tag = update.tagName ? `, previous tag ${update.tagName}` : '';
	return `${field}${update.packageName}: ${compactValue(update.from, 90)} -> ${compactValue(update.to, 90)}${tag}`;
}

export function pointerUpdateBullet(pointer: CommitMessageSubmodulePointer) {
	const label = pointer.packageName ? `${pointer.packageName} ${pointer.path}` : pointer.path;
	return `${label}: ${shortSha(pointer.oldSha)} -> ${shortSha(pointer.newSha)}`;
}

export function fallbackChanges(context: CommitMessageContext) {
	const paths = changedPaths(context.changedFiles);
	const bullets: string[] = [];
	if (paths.length > 0) {
		bullets.push(`Updates ${paths.length} file${paths.length === 1 ? '' : 's'} across ${formatGroups(paths)}.`);
		bullets.push(`Touches ${paths.slice(0, 6).join(', ')}${paths.length > 6 ? ', ...' : ''}.`);
	} else {
		bullets.push('Records the staged repository changes supplied to the save workflow.');
	}
	if (context.plannedTag || context.plannedVersion) {
		bullets.push(`Plans package version/tag ${context.plannedTag ?? context.plannedVersion} for ${context.repoName}.`);
	}
	return bullets;
}

export function generateFallbackCommitMessage(context: CommitMessageContext) {
	const type = inferType(context);
	const scope = inferScope(context);
	const summary = fallbackSummary(context, type, scope);
	const intent = context.userMessage?.trim()
		? [`Save hint: ${summaryFromHint(context.userMessage) ?? normalizeWhitespace(context.userMessage)}`]
		: [];
	const dependencyUpdates = [
		...(context.dependencyUpdates ?? []).map(dependencyUpdateBullet),
		...(context.submodulePointers ?? []).map(pointerUpdateBullet),
	];
	return formatCommitMessage(type, scope, summary, {
		intent,
		changes: fallbackChanges(context),
		packageChanges: (context.packageChanges ?? []).map(packageChangeBullet),
		dependencyUpdates,
	});
}

export type ParsedSections = {
	intent: string[];
	changes: string[];
	packageChanges: string[];
	dependencyUpdates: string[];
};

export function sectionKey(heading: string) {
	if (heading === 'Intent') return 'intent';
	if (heading === 'Changes') return 'changes';
	if (heading === 'Integrated package changes') return 'packageChanges';
	if (heading === 'Dependency and pointer updates') return 'dependencyUpdates';
	return null;
}

export function parseCommitSections(lines: string[]) {
	const sections: ParsedSections = {
		intent: [],
		changes: [],
		packageChanges: [],
		dependencyUpdates: [],
	};
	let current: keyof ParsedSections | null = null;
	let lastBullet: string | null = null;
	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		if (!line.trim()) continue;
		const headingMatch = line.trim().match(/^([^:]+):$/u);
		if (headingMatch) {
			const heading = headingMatch[1].trim();
			if (forbiddenSectionHeadings.has(heading)) {
				throw new Error(`AI commit message included forbidden ${heading} section.`);
			}
			if (!allowedSectionHeadings.has(heading)) {
				throw new Error(`AI commit message included unsupported ${heading} section.`);
			}
			current = sectionKey(heading);
			lastBullet = null;
			continue;
		}
		if (!current) {
			throw new Error('AI commit message included body text before a supported section.');
		}
		if (line.trim().startsWith('- ')) {
			lastBullet = line.trim().replace(/^-\s*/u, '');
			sections[current].push(lastBullet);
			continue;
		}
		if (/^\s+/u.test(line) && lastBullet != null) {
			sections[current][sections[current].length - 1] = `${sections[current][sections[current].length - 1]} ${line.trim()}`;
			continue;
		}
		throw new Error('AI commit message section content must use bullets.');
	}
	return sections;
}

export function assertCommitTemplate(message: string, context: CommitMessageContext) {
	const normalized = stripControlCharacters(message)
		.replace(/^```(?:text)?\s*/iu, '')
		.replace(/```\s*$/u, '')
		.trim();
	const [subject = '', ...rest] = normalized.split(/\r?\n/u);
	const subjectMatch = subject.trim().match(/^(feat|fix|refactor|test|docs|build|ci|chore)\(([a-z0-9-]+)\):\s*(.+)$/u);
	if (!subjectMatch) {
		throw new Error('AI commit message did not use the required subject template.');
	}
	const [, type, scope, summary] = subjectMatch;
	if (danglingSubjectEndings.has(lastSummaryWord(summary))) {
		throw new Error('AI commit message subject appears truncated.');
	}
	const sections = parseCommitSections(rest);
	if (sections.changes.length === 0) {
		throw new Error('AI commit message did not include a Changes section.');
	}
	if (sections.intent.length > 0 && !context.userMessage?.trim()) {
		throw new Error('AI commit message included Intent without a save hint.');
	}
	if (context.userMessage?.trim() && sections.intent.length === 0) {
		throw new Error('AI commit message omitted Intent for the provided save hint.');
	}
	return formatCommitMessage(type, scope, summary, {
		intent: sections.intent,
		changes: sections.changes,
		packageChanges: sections.packageChanges,
		dependencyUpdates: sections.dependencyUpdates,
	});
}

export function cloudflareEndpoint(accountId: string, model: string, gatewayId: string | null) {
	const normalizedModel = model.replace(/^\/+/u, '');
	if (gatewayId) {
		return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}/workers-ai/${normalizedModel}`;
	}
	return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${normalizedModel}`;
}
