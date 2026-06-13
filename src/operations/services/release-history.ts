import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runTreeseedGit } from './git-runner.ts';

export type ReleaseHistoryCommit = {
	sha: string;
	subject: string;
	body: string;
};

export type ReleaseHistorySection =
	| 'Added'
	| 'Changed'
	| 'Fixed'
	| 'Infrastructure'
	| 'Tests'
	| 'Dependencies';

export type ReleaseHistorySummary = {
	version: string;
	date: string;
	sourceRef: string;
	targetRef: string;
	commitCount: number;
	sections: Record<ReleaseHistorySection, string[]>;
	notableCommits: ReleaseHistoryCommit[];
	changelogPath: string;
	changelogUpdated: boolean;
	entry: string;
};

const SECTION_ORDER: ReleaseHistorySection[] = [
	'Added',
	'Changed',
	'Fixed',
	'Infrastructure',
	'Tests',
	'Dependencies',
];

function runGit(repoDir: string, args: string[]) {
	const result = runTreeseedGit(args, {
		cwd: repoDir,
		mode: 'read',
	});
	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `git ${args.join(' ')} failed`);
	}
	return result.stdout;
}

function shortSha(value: string) {
	return value.slice(0, 12);
}

function cleanLine(value: string) {
	return value.replace(/\s+/gu, ' ').trim();
}

function bulletText(commit: ReleaseHistoryCommit) {
	const subject = cleanLine(commit.subject);
	return subject ? `${subject} (${shortSha(commit.sha)})` : shortSha(commit.sha);
}

function sectionForCommit(commit: ReleaseHistoryCommit): ReleaseHistorySection {
	const value = `${commit.subject}\n${commit.body}`.toLowerCase();
	if (/^(feat|add)(\(|:)/u.test(value) || /\badded?\b/u.test(value)) return 'Added';
	if (/^(fix|hotfix)(\(|:)/u.test(value) || /\bfix(e[ds])?\b|\bbug\b/u.test(value)) return 'Fixed';
	if (/^(test)(\(|:)/u.test(value) || /\btest(s|ing)?\b|\bverify\b/u.test(value)) return 'Tests';
	if (/^(deps?|build)(\(|:)/u.test(value) || /\bdependenc(y|ies)\b|\blockfile\b|\bpackage pointer\b/u.test(value)) return 'Dependencies';
	if (/^(ci|chore|release)(\(|:)/u.test(value) || /\bdeploy\b|\bworkflow\b|\brelease\b|\bsubmodule\b/u.test(value)) return 'Infrastructure';
	return 'Changed';
}

function uniqueSectionBullets(commits: ReleaseHistoryCommit[]) {
	const sections = Object.fromEntries(SECTION_ORDER.map((section) => [section, []])) as Record<ReleaseHistorySection, string[]>;
	const seen = new Set<string>();
	for (const commit of commits) {
		const bullet = bulletText(commit);
		const key = bullet.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		sections[sectionForCommit(commit)].push(bullet);
	}
	return sections;
}

export function collectReleaseHistoryCommits(repoDir: string, sourceRef: string, targetRef: string, options: { maxCommits?: number } = {}) {
	const maxCommits = options.maxCommits ?? 80;
	const output = runGit(repoDir, [
		'log',
		'--no-merges',
		`--max-count=${maxCommits}`,
		'--format=%H%x1f%s%x1f%b%x1e',
		`${sourceRef}..${targetRef}`,
	]);
	return output
		.split('\x1e')
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry): ReleaseHistoryCommit => {
			const [sha = '', subject = '', body = ''] = entry.split('\x1f');
			return { sha: sha.trim(), subject: subject.trim(), body: body.trim() };
		})
		.filter((commit) => commit.sha.length > 0);
}

export function renderReleaseChangelogEntry(input: {
	version: string;
	date?: string;
	commits: ReleaseHistoryCommit[];
	extraBullets?: Partial<Record<ReleaseHistorySection, string[]>>;
}) {
	const date = input.date ?? new Date().toISOString().slice(0, 10);
	const sections = uniqueSectionBullets(input.commits);
	for (const [section, bullets] of Object.entries(input.extraBullets ?? {}) as Array<[ReleaseHistorySection, string[] | undefined]>) {
		for (const bullet of bullets ?? []) {
			const normalized = cleanLine(bullet);
			if (normalized) sections[section].push(normalized);
		}
	}
	const lines = [`## [${input.version}] - ${date}`, ''];
	let wroteSection = false;
	for (const section of SECTION_ORDER) {
		const bullets = sections[section];
		if (bullets.length === 0) continue;
		wroteSection = true;
		lines.push(`### ${section}`, '');
		for (const bullet of bullets.slice(0, 20)) {
			lines.push(`- ${bullet}`);
		}
		if (bullets.length > 20) {
			lines.push(`- ${bullets.length - 20} additional change${bullets.length - 20 === 1 ? '' : 's'} omitted from this summary.`);
		}
		lines.push('');
	}
	if (!wroteSection) {
		lines.push('### Changed', '', '- Release metadata and deployment history updated.', '');
	}
	return {
		date,
		sections,
		entry: lines.join('\n').trimEnd(),
	};
}

export function upsertReleaseChangelog(repoDir: string, input: {
	version: string;
	sourceRef: string;
	targetRef: string;
	commits: ReleaseHistoryCommit[];
	extraBullets?: Partial<Record<ReleaseHistorySection, string[]>>;
}) {
	const rendered = renderReleaseChangelogEntry(input);
	const changelogPath = resolve(repoDir, 'CHANGELOG.md');
	const current = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '';
	const title = '# Changelog';
	const withoutExisting = current
		.replace(new RegExp(`^# Changelog\\s*\\n+## \\[${input.version.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\][\\s\\S]*?(?=\\n## \\[|$)`, 'u'), `${title}\n\n`)
		.trim();
	const body = withoutExisting.startsWith(title)
		? withoutExisting.slice(title.length).trim()
		: withoutExisting.trim();
	const next = `${title}\n\n${rendered.entry}${body ? `\n\n${body}` : ''}\n`;
	const changed = current !== next;
	if (changed) {
		writeFileSync(changelogPath, next, 'utf8');
	}
	return {
		version: input.version,
		date: rendered.date,
		sourceRef: input.sourceRef,
		targetRef: input.targetRef,
		commitCount: input.commits.length,
		sections: rendered.sections,
		notableCommits: input.commits.slice(0, 12),
		changelogPath,
		changelogUpdated: changed,
		entry: rendered.entry,
	} satisfies ReleaseHistorySummary;
}

export function renderAdministrativeCommitMessage(input: {
	subject: string;
	version?: string | null;
	tagName?: string | null;
	sourceRef: string;
	targetRef: string;
	commits: ReleaseHistoryCommit[];
	changelog?: ReleaseHistorySummary | null;
	extraLines?: string[];
}) {
	const lines = [
		input.subject,
		'',
		'Release summary:',
		input.version ? `- Version: ${input.version}` : null,
		input.tagName ? `- Tag: ${input.tagName}` : null,
		`- Source: ${input.sourceRef}`,
		`- Target: ${input.targetRef}`,
		`- Promoted commits: ${input.commits.length}`,
		...(input.extraLines ?? []).map((line) => `- ${line}`),
		'',
		'Notable changes:',
		...(input.commits.length > 0
			? input.commits.slice(0, 12).map((commit) => `- ${bulletText(commit)}`)
			: ['- Release metadata and package pointers updated.']),
		input.commits.length > 12 ? `- ${input.commits.length - 12} additional promoted commit${input.commits.length - 12 === 1 ? '' : 's'} omitted from this summary.` : null,
		input.changelog ? '' : null,
		input.changelog ? 'See CHANGELOG.md for the release history entry.' : null,
	].filter((line): line is string => line !== null);
	return lines.join('\n');
}
