import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { serializeFrontmatterDocument, parseFrontmatterDocument } from '../../content/frontmatter.ts';
import {
	applyProjectLaunchHostBindingConfig,
	auditProjectLaunchHostBindingConfig,
	type ApplyProjectLaunchHostBindingConfigOptions,
} from '../services/hosting/deployment/template-host-bindings.ts';
import { NormalizedPlatformContentInput, PROPOSAL_VERDICT_DECISION_TYPES, PlatformRepositoryOperationInput, WORK_CONTENT_COLLECTION_SET } from './exec-file-async.ts';
import { addRelationValue, assertAllowedPath, contentRoot, enumValue, normalizePlatformContentInput, normalizePlatformRelationArray, optionalTrimmedString, platformContentRelationPolicy, safeContentPath, safeRepositoryRelativePath, secretLookingText, slugifyPlatformContent } from './platform-repository-verification-error.ts';
import { changedPaths } from './create-decision-from-governance-proposal.ts';

export async function initializeLinkedRepository(repoPath: string, input: PlatformRepositoryOperationInput) {
	const architecture = input.architecture && typeof input.architecture === 'object' && !Array.isArray(input.architecture)
		? {
			topology: input.architecture.topology ?? null,
			rootPath: input.architecture.rootPath ?? '.',
			sitePath: input.architecture.sitePath ?? null,
			contentPath: input.architecture.contentPath ?? null,
			contentRuntimeSource: input.architecture.contentRuntimeSource ?? null,
			localContentMaterialization: input.architecture.localContentMaterialization ?? null,
		}
		: null;
	const scaffoldFiles = Array.isArray(input.scaffoldFiles) ? input.scaffoldFiles : [];
	const scaffoldedPaths: string[] = [];
	for (const file of scaffoldFiles) {
		if (!file || typeof file !== 'object') throw new Error('Repository initialization scaffold files must be objects.');
		const content = typeof file.content === 'string' ? file.content : null;
		if (content == null) throw new Error('Repository initialization scaffold file content must be a string.');
		if (secretLookingText(content) || secretLookingText(file.path)) {
			throw new Error('Repository initialization scaffold files must not contain token-like or plaintext secret material.');
		}
		const { target, relativePath } = safeRepositoryRelativePath(repoPath, file.path);
		if (existsSync(target) && file.overwrite !== true) continue;
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, content, 'utf8');
		scaffoldedPaths.push(relativePath);
	}
	return {
		kind: 'linked_repository_initialization',
		projectId: input.projectId ?? null,
		teamId: input.teamId ?? null,
		mode: scaffoldedPaths.length > 0 ? 'template_scaffold' : 'adopt_existing',
		architecture,
		scaffoldedPaths,
	};
}

export async function readContentRecord(repoPath: string, collection: string, slug: string) {
	if (!WORK_CONTENT_COLLECTION_SET.has(collection)) throw new Error('Unsupported content collection.');
	const target = safeContentPath(repoPath, collection, slug);
	if (!existsSync(target)) throw new Error('Parent content record was not found.');
	const parsed = parseFrontmatterDocument(await readFile(target, 'utf8'));
	if (!parsed.frontmatter || typeof parsed.frontmatter !== 'object' || Array.isArray(parsed.frontmatter)) {
		throw new Error('Content frontmatter could not be parsed.');
	}
	return {
		path: target,
		slug,
		extension: target.endsWith('.md') ? 'md' : 'mdx',
		frontmatter: parsed.frontmatter,
		body: parsed.body,
	};
}

export async function writeParsedRecord(repoPath: string, record: { path: string; frontmatter: Record<string, unknown>; body: string }) {
	const relativePath = assertAllowedPath(repoPath, record.path);
	await mkdir(dirname(record.path), { recursive: true });
	await writeFile(record.path, serializeFrontmatterDocument(record.frontmatter, `\n${String(record.body ?? '').trim()}\n`), 'utf8');
	return relativePath;
}

export async function writeContentRecord(repoPath: string, collection: string, input: Record<string, unknown>, normalizedInput?: NormalizedPlatformContentInput) {
	const normalized = normalizedInput ?? normalizePlatformContentInput(collection, input);
	if ('error' in normalized) throw new Error(normalized.error);
	const root = contentRoot(repoPath, collection);
	const existingTarget = input.overwrite === true
		? [`${normalized.slug}.mdx`, `${normalized.slug}.md`]
			.map((file) => resolve(root, file))
			.find((candidate) => existsSync(candidate))
		: null;
	const target = existingTarget ?? safeContentPath(repoPath, collection, normalized.slug, normalized.extension);
	if (existsSync(target) && input.overwrite !== true) throw new Error('A content record with that slug already exists.');
	const frontmatter = existingTarget && input.preserveFrontmatter === true
		? {
			...normalized.frontmatter,
			...(await readContentRecord(repoPath, collection, normalized.slug)).frontmatter,
		}
		: normalized.frontmatter;
	const relativePath = await writeParsedRecord(repoPath, {
		path: target,
		frontmatter,
		body: normalized.body,
	});
	return {
		collection,
		slug: normalized.slug,
		id: frontmatter.id,
		path: relativePath,
		href: collection === 'agents'
			? `/app/projects/${encodeURIComponent(String(input.projectId ?? ''))}/agents/${encodeURIComponent(normalized.slug)}`
			: `/app/work/${collection}/${encodeURIComponent(normalized.slug)}`,
	};
}

export async function createRelatedContent(repoPath: string, input: PlatformRepositoryOperationInput) {
	const parentCollection = String(input.parentCollection ?? '');
	const targetCollection = String(input.targetCollection ?? input.collection ?? '');
	if (!WORK_CONTENT_COLLECTION_SET.has(parentCollection) || !WORK_CONTENT_COLLECTION_SET.has(targetCollection)) {
		throw new Error('Unsupported content relation collection.');
	}
	const policy = platformContentRelationPolicy(parentCollection, targetCollection);
	if (!policy) throw new Error(`Cannot create related ${targetCollection} from ${parentCollection}.`);
	const parentSlug = optionalTrimmedString(input.parentSlug);
	if (!parentSlug) throw new Error('parentSlug is required.');
	const parent = await readContentRecord(repoPath, parentCollection, parentSlug);
	const normalized = input.normalized ?? normalizePlatformContentInput(targetCollection, input.payload ?? {});
	if ('error' in normalized) throw new Error(normalized.error);
	const childTarget = safeContentPath(repoPath, targetCollection, normalized.slug, normalized.extension);
	if (existsSync(childTarget)) throw new Error('A content record with that slug already exists.');
	addRelationValue(parent.frontmatter, policy.sourceField, normalized.slug, policy.sourceSingle);
	addRelationValue(normalized.frontmatter, policy.targetField, parent.slug, policy.targetSingle);
	await mkdir(contentRoot(repoPath, targetCollection), { recursive: true });
	const child = {
		path: childTarget,
		frontmatter: normalized.frontmatter,
		body: normalized.body,
	};
	const originalParent = { ...parent, frontmatter: { ...parent.frontmatter }, body: parent.body };
	const changedPaths = [];
	try {
		changedPaths.push(await writeParsedRecord(repoPath, child));
		changedPaths.push(await writeParsedRecord(repoPath, parent));
	} catch (error) {
		await rm(childTarget, { force: true }).catch(() => {});
		await writeParsedRecord(repoPath, originalParent).catch(() => {});
		throw error;
	}
	return {
		parent: {
			collection: parentCollection,
			slug: parent.slug,
			path: relative(repoPath, parent.path),
			href: `/app/work/${parentCollection}/${encodeURIComponent(parent.slug)}`,
		},
		child: {
			collection: targetCollection,
			slug: normalized.slug,
			id: normalized.frontmatter.id,
			path: relative(repoPath, childTarget),
			href: `/app/work/${targetCollection}/${encodeURIComponent(normalized.slug)}`,
		},
		relation: {
			parentField: policy.sourceField,
			childField: policy.targetField,
		},
		changedPaths,
	};
}

export async function createDecisionFromProposals(repoPath: string, input: PlatformRepositoryOperationInput) {
	const proposalSlugs = [...new Set(normalizePlatformRelationArray(input.proposalSlugs ?? input.payload?.proposalSlugs))];
	if (proposalSlugs.length === 0) throw new Error('Select at least one proposal.');
	for (const slug of proposalSlugs) {
		if (!slug || slugifyPlatformContent(slug) !== slug) throw new Error('Unsafe proposal slug.');
	}
	const decisionType = enumValue(input.decisionType ?? input.payload?.decisionType, [...PROPOSAL_VERDICT_DECISION_TYPES], null);
	if (!decisionType) throw new Error('Unsupported proposal verdict.');
	const reason = optionalTrimmedString(input.reason) ?? optionalTrimmedString(input.payload?.reason) ?? optionalTrimmedString(input.payload?.rationale);
	if (!reason) throw new Error('A decision reason is required.');
	const title = optionalTrimmedString(input.title) ?? optionalTrimmedString(input.payload?.title) ?? `Decision for ${proposalSlugs.length === 1 ? proposalSlugs[0] : `${proposalSlugs.length} proposals`}`;
	const decisionSlug = slugifyPlatformContent(input.slug || input.payload?.slug || title);
	if (!decisionSlug) throw new Error('A safe decision slug is required.');
	const decisionTarget = safeContentPath(repoPath, 'decisions', decisionSlug, 'mdx');
	if (existsSync(decisionTarget)) throw new Error('A decision with that slug already exists.');
	const proposals = [];
	for (const slug of proposalSlugs) {
		try {
			proposals.push(await readContentRecord(repoPath, 'proposals', slug));
		} catch {
			throw new Error(`Proposal ${slug} was not found.`);
		}
	}
	const proposalTitles = proposals.map((proposal) => proposal.frontmatter.title ?? proposal.slug);
	const body = optionalTrimmedString(input.payload?.body)
		?? [
			'## Verdict',
			decisionType.replace(/_/gu, ' '),
			'',
			'## Reason',
			reason,
			'',
			'## Proposals',
			...proposalTitles.map((proposalTitle, index) => `- ${proposalTitle} (${proposalSlugs[index]})`),
		].join('\n');
	const decision = await writeContentRecord(repoPath, 'decisions', {
		...(input.payload ?? {}),
		projectId: input.projectId,
		slug: decisionSlug,
		title,
		status: 'live',
		decisionType,
		description: optionalTrimmedString(input.payload?.description) ?? reason,
		summary: optionalTrimmedString(input.payload?.summary) ?? reason,
		rationale: reason,
		relatedProposals: proposalSlugs,
		body,
	});
	const writtenProposals = [];
	const originalProposals = proposals.map((proposal) => ({
		...proposal,
		frontmatter: { ...proposal.frontmatter },
		body: proposal.body,
	}));
	const changedPaths = [decision.path];
	try {
		for (const proposal of proposals) {
			proposal.frontmatter.decision = decisionSlug;
			changedPaths.push(await writeParsedRecord(repoPath, proposal));
			writtenProposals.push(proposal);
		}
	} catch (error) {
		await rm(decisionTarget, { force: true }).catch(() => {});
		for (const original of originalProposals.slice(0, writtenProposals.length)) {
			await writeParsedRecord(repoPath, original).catch(() => {});
		}
		throw error;
	}
	return {
		decision,
		proposals: proposalSlugs.map((slug) => ({ collection: 'proposals', slug, href: `/app/work/proposals/${encodeURIComponent(slug)}` })),
		href: decision.href,
		changedPaths,
	};
}
