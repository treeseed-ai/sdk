import { createHash } from 'node:crypto';
import { existsSync,mkdtempSync,readdirSync,readFileSync,rmSync,statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename,relative,resolve } from 'node:path';
import { runRepositoryGit } from '../operations/git-runner.ts';
import { buildTemplateReplacements } from '../template-registry/sync-managed-package-json.ts';
import { loadJsonFile,listFiles,type ResolvedTemplateDefinition,type TemplateManifest,validateTemplateManifest } from '../template-registry/template-categories.ts';
import { copyTemplateTree,readGitOutput,renderTemplateFile,writeTemplateState } from '../template-registry/validate-template-placeholders.ts';

const CANONICAL_REPOSITORY = 'treeseed-ai/platform';
const SHA = /^[a-f0-9]{40}$/u;

export type PlatformInitializationInput = {
	targetRoot: string;
	repository: string;
	ref: string;
	templateId: string;
	team: string;
	controlPlaneBaseUrl?: string;
};

export type PlatformInitializationPlan = {
	kind: 'treeseed.platform-initialization-plan/v1';
	repository: string;
	repositoryUrl: string;
	targetRoot: string;
	requestedRef: string;
	observedRef: string;
	templateId: string;
	templateDigest: string;
	team: string;
	changedPaths: string[];
	targetState: 'absent'|'initialized'|'blocked';
	blockers: string[];
};

function git(args: string[], cwd?: string, allowFailure = false) {
	return runRepositoryGit(args, { cwd: cwd ?? process.cwd(), mode: ['clone','checkout'].includes(args[0] ?? '') ? 'mutate' : 'read', allowFailure });
}

function normalizeRepository(value: string) {
	const normalized = value.trim().replace(/^https:\/\/github\.com\//u, '').replace(/\.git$/u, '');
	if (normalized !== CANONICAL_REPOSITORY) throw new Error(`Platform initialization requires ${CANONICAL_REPOSITORY}.`);
	return normalized;
}

function remoteRef(repositoryUrl: string, requestedRef: string) {
	const selector = SHA.test(requestedRef) ? requestedRef : `refs/heads/${requestedRef}`;
	const result = git(['ls-remote', repositoryUrl, selector], undefined, true);
	const observed = result.status === 0 ? result.stdout.trim().split(/\s+/u)[0] ?? '' : '';
	if (!SHA.test(observed)) throw new Error(`Unable to observe exact Platform ref ${requestedRef}.`);
	return observed;
}

function definition(repoRoot: string, templateId: string): ResolvedTemplateDefinition {
	const artifactRoot = resolve(repoRoot, 'templates', templateId);
	const manifestPath = resolve(artifactRoot, 'template.config.json');
	const templateRoot = resolve(artifactRoot, 'template');
	if (!existsSync(manifestPath)) throw new Error(`Platform ref does not contain template ${templateId}.`);
	const manifest = loadJsonFile<TemplateManifest>(manifestPath);
	const source = { kind: 'git' as const, repoUrl: `https://github.com/${CANONICAL_REPOSITORY}.git`, ref: readGitOutput(['rev-parse','HEAD'], repoRoot)!, directory: `templates/${templateId}` };
	const resolved = { manifestPath, templateRoot, manifest, product: {
		id: templateId, displayName: manifest.displayName, description: manifest.description, summary: manifest.description,
		category: manifest.category, tags: manifest.tags, status: 'live' as const, featured: templateId === 'platform-local-managed-codex',
		templateVersion: manifest.templateVersion ?? '1.0.0', templateApiVersion: manifest.templateApiVersion,
		minCliVersion: manifest.minCliVersion, minCoreVersion: manifest.minCoreVersion,
		fulfillment: { mode: 'git' as const, source }, contentPath: `${source.repoUrl}#${templateId}`,
		artifactRoot, artifactManifestPath: manifestPath, templateRoot, fulfillmentMode: 'git' as const,
	} };
	validateTemplateManifest(resolved);
	if (manifest.category !== 'platform') throw new Error(`${templateId} is not a Platform template.`);
	return resolved;
}

function digestTemplate(item: ResolvedTemplateDefinition, replacements: Record<string,string>) {
	const hash = createHash('sha256').update(JSON.stringify(item.manifest));
	for (const path of listFiles(item.templateRoot).sort()) hash.update(relative(item.templateRoot, path)).update('\0').update(renderTemplateFile(path, replacements));
	return `sha256:${hash.update(JSON.stringify(replacements)).digest('hex')}`;
}

function inspectTarget(targetRoot: string) {
	if (!existsSync(targetRoot)) return 'absent' as const;
	if (!statSync(targetRoot).isDirectory()) return 'blocked' as const;
	const entries = readdirSync(targetRoot);
	return entries.length === 0 ? 'absent' as const : existsSync(resolve(targetRoot, '.git')) ? 'initialized' as const : 'blocked' as const;
}

function changedPaths(repoRoot: string, item: ResolvedTemplateDefinition, replacements: Record<string,string>) {
	return listFiles(item.templateRoot).map((path) => relative(item.templateRoot, path)).filter((path) => {
		const target = resolve(repoRoot, path);
		return !existsSync(target) || readFileSync(target, 'utf8') !== renderTemplateFile(resolve(item.templateRoot, path), replacements);
	}).sort();
}

function inspectCheckout(repoRoot: string, input: PlatformInitializationInput, observedRef: string) {
	const origin = readGitOutput(['config','--get','remote.origin.url'], repoRoot)?.replace(/\.git$/u, '');
	const head = readGitOutput(['rev-parse','HEAD'], repoRoot);
	if (origin !== `https://github.com/${CANONICAL_REPOSITORY}` && origin !== `git@github.com:${CANONICAL_REPOSITORY}`) throw new Error('Existing Platform checkout has the wrong origin.');
	if (head !== observedRef) throw new Error(`Existing Platform checkout is ${head ?? 'unknown'}, expected ${observedRef}.`);
	const item = definition(repoRoot, input.templateId);
	const replacements = buildTemplateReplacements(item.manifest, { target: basename(repoRoot), controlPlaneBaseUrl: input.controlPlaneBaseUrl });
	return { item, replacements, changes: changedPaths(repoRoot, item, replacements) };
}

export function planPlatformInitialization(input: PlatformInitializationInput): PlatformInitializationPlan {
	const repository = normalizeRepository(input.repository);
	const repositoryUrl = `https://github.com/${repository}.git`;
	const observedRef = remoteRef(repositoryUrl, input.ref);
	const targetRoot = resolve(input.targetRoot);
	const state = inspectTarget(targetRoot);
	const temporary = state === 'initialized' ? null : mkdtempSync(resolve(tmpdir(), 'trsd-platform-init-'));
	try {
		const repoRoot = temporary ? resolve(temporary, 'platform') : targetRoot;
		if (temporary) {
			const clone = git(['clone','--no-checkout',repositoryUrl,repoRoot]);
			if (clone.status !== 0) throw new Error(clone.stderr.trim() || 'Unable to inspect Platform repository.');
			git(['checkout','--detach',observedRef],repoRoot);
		}
		const inspected = inspectCheckout(repoRoot, input, observedRef);
		const blockers = state === 'blocked' ? ['Target exists and is neither empty nor the requested Platform checkout.'] : [];
		return { kind: 'treeseed.platform-initialization-plan/v1', repository, repositoryUrl, targetRoot, requestedRef: input.ref, observedRef,
			templateId: input.templateId, templateDigest: digestTemplate(inspected.item, inspected.replacements), team: input.team,
			changedPaths: inspected.changes, targetState: blockers.length ? 'blocked' : state, blockers };
	} finally {
		if (temporary) rmSync(temporary, { recursive: true, force: true });
	}
}

export function applyPlatformInitialization(input: PlatformInitializationInput) {
	const plan = planPlatformInitialization(input);
	if (plan.blockers.length) throw new Error(plan.blockers.join(' '));
	if (plan.targetState === 'absent') {
		const clone = git(['clone','--branch',SHA.test(input.ref) ? 'staging' : input.ref,'--single-branch',plan.repositoryUrl,plan.targetRoot]);
		if (clone.status !== 0) throw new Error(clone.stderr.trim() || 'Unable to clone Platform repository.');
		if (SHA.test(input.ref)) git(['checkout','--detach',plan.observedRef],plan.targetRoot);
	}
	const inspected = inspectCheckout(plan.targetRoot, input, plan.observedRef);
	copyTemplateTree(inspected.item.templateRoot, plan.targetRoot, inspected.replacements);
	writeTemplateState(plan.targetRoot, { templateId: input.templateId, templateVersion: inspected.item.manifest.templateVersion, sourceRef: plan.observedRef,
		installedAt: new Date().toISOString(), lastSyncedAt: new Date().toISOString(), replacements: inspected.replacements,
		definitionDigest: plan.templateDigest, managedPaths: [...(inspected.item.manifest.managedSurface?.coreManaged ?? [])].sort(),
		seedPaths: [...(inspected.item.manifest.platform?.seeds ?? [])].sort(), scenePaths: [...(inspected.item.manifest.platform?.scenes ?? [])].sort() });
	const dirty = readGitOutput(['status','--porcelain'],plan.targetRoot) ?? '';
	if (dirty) throw new Error(`Platform template produced tracked divergence:\n${dirty}`);
	return { ...plan, kind: 'treeseed.platform-initialization-receipt/v1' as const, applied: true, repositoryClean: true };
}
