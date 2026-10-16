import {verifySdkDocumentationExamples} from './documentation-examples.ts';
export {verifySdkDocumentationExamples} from './documentation-examples.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { assignmentReferenceSchema, type AssignmentAttempt, type AssignmentReference, type AssignmentResult } from '@treeseed/sdk/agent-capacity';
import { sourceWorkspaceKeySchema, sourceWorkspaceAuthorizationSchema } from '@treeseed/sdk/capacity-provider/sandbox';

export type PublishedSourceAttempt = Pick<AssignmentAttempt, 'id' | 'teamId' | 'projectId' | 'attempt' | 'workspace'>
	& { provider: Pick<AssignmentAttempt['provider'], 'providerId'> };

const failure = 'ACCEPTANCE_SDK_NATIVE_TEST_CHAIN';
/** Join original reviewed predecessors; workspace compilation remains API-owned. */
export function verifySdkReviewedSourceInput(next: Pick<AssignmentAttempt, 'workspace' | 'predecessorResultIds' | 'createdAt'>,
	predecessor: Pick<AssignmentResult, 'id'>, review: Pick<AssignmentResult, 'id' | 'completedAt'>, reference: AssignmentReference): void {
	assert.ok(reference.kind === 'git', failure);
	assert.ok(next.predecessorResultIds.includes(predecessor.id) && next.predecessorResultIds.includes(review.id), failure);
	assert.ok(next.workspace.mode === 'git' && next.workspace.repository === reference.repository, failure);
	assert.ok(Date.parse(review.completedAt) <= Date.parse(next.createdAt), failure);
}
const object = (value: unknown): Record<string, unknown> => {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value), failure);
	return value as Record<string, unknown>;
};

/** The existing fixed public owning inventory supplies the locator, never an operator path. */
export function sdkPublishedRepository(workspace: unknown, sandboxId: string, attempt: PublishedSourceAttempt, reference: AssignmentReference) {
	const observation = object(workspace), scope = object(observation.scope), journals = object(observation.journals);
	assert.equal(observation.complete, true, failure); assert.deepEqual(observation.errors, [], failure);
	assert.equal(scope.storageRoot, '/var/lib/treeseed/agent/workspaces', failure);
	assert.match(sandboxId, /^sandbox-[A-Za-z0-9-]{1,128}$/u, failure);
	assert.deepEqual(object(observation.confirmation).journals, journals, failure);
	const entry = (kind: string) => {
		const inventory = object(journals[kind]); assert.equal(inventory.rootPresent, true, failure);
		assert.ok(Array.isArray(inventory.entries), failure);
		const matches = inventory.entries.map(object).filter(item => item.name === `${sandboxId}.json`);
		assert.equal(matches.length, 1, failure); const value = matches[0]!;
		assert.equal(value.type, 'file', failure); assert.match(String(value.digest), /^[a-f0-9]{64}$/u, failure);
		return object(value.metadata);
	};
	const job = entry('jobs'), result = entry('results');
	assert.equal(job.schemaVersion, 'treeseed.assignment-source-job/v1', failure);
	assert.deepEqual(job.owner, { assignmentId: attempt.id, providerId: attempt.provider.providerId,
		teamId: attempt.teamId, projectId: attempt.projectId, attempt: attempt.attempt }, failure);
	assert.equal(result.schemaVersion, 'treeseed.source-result/v1', failure);
	assert.equal(result.sandboxId, sandboxId, failure); assert.equal(result.leaseId, job.leaseId, failure);
	assert.ok(typeof result.leaseId === 'string' && result.leaseId.length > 0, failure);
	assert.equal(result.status, 'completed', failure); assert.equal(result.teardownVerified, true, failure);
	const source = sourceWorkspaceKeySchema.parse(result.source);
	assert.equal(source.teamId, attempt.teamId, failure); assert.equal(source.projectId, attempt.projectId, failure);
	assert.equal(attempt.workspace.mode, 'git', failure);
	assert.ok(attempt.workspace.mode === 'git'); assert.equal(source.commit, attempt.workspace.baseCommit, failure);
	assert.equal(reference.kind, 'git', failure); assert.deepEqual(assignmentReferenceSchema.parse(result.sourceReference), reference, failure);
	assert.ok(reference.kind === 'git'); assert.equal(reference.repository, attempt.workspace.repository, failure);
	assert.equal(reference.branch, attempt.workspace.branch, failure);
 const parsedAuthority = sourceWorkspaceAuthorizationSchema.safeParse(job.authority); assert.ok(parsedAuthority.success, failure);
 const authority = parsedAuthority.data; assert.deepEqual(authority, job.authority, failure);
 assert.equal(authority.assignmentId, attempt.id, failure); assert.equal(authority.providerId, attempt.provider.providerId, failure);
 assert.equal(authority.attempt, attempt.attempt, failure); assert.deepEqual(authority.source, source, failure);
 assert.equal(authority.mode, 'work', failure); assert.equal(authority.publication, 'simulation-branch', failure);
 assert.ok(['upstream-public', 'simulation-local'].includes(authority.acquisition), failure);
 assert.equal(Object.hasOwn(authority, 'credentialBindingId'), false, failure);
 assert.equal(authority.publicationRef, reference.branch, failure);

	const candidate = entry('candidates'), verification = object(candidate.verification);
	assert.equal(candidate.state, 'published', failure);
	assert.equal(candidate.assignmentId, attempt.id, failure); assert.equal(candidate.attempt, attempt.attempt, failure);
	assert.equal(candidate.providerId, attempt.provider.providerId, failure); assert.equal(candidate.leaseId, job.leaseId, failure);
	const candidateSource = sourceWorkspaceKeySchema.safeParse(candidate.source); assert.ok(candidateSource.success, failure);
	assert.deepEqual(candidateSource.data, candidate.source, failure); assert.deepEqual(candidateSource.data, source, failure);
	assert.equal(candidate.commit, reference.commit, failure); assert.equal(verification.baseCommit, attempt.workspace.baseCommit, failure);
	assert.equal(verification.commit, reference.commit, failure);
	assert.deepEqual(Object.keys(verification).sort(), ['ancestry', 'baseCommit', 'bytes', 'clean', 'commit', 'isolatedVerifier', 'objectClosure'], failure);
	assert.ok(Number.isSafeInteger(verification.bytes) && Number(verification.bytes) > 0, failure);
	for (const flag of ['clean', 'objectClosure', 'ancestry', 'isolatedVerifier']) assert.equal(verification[flag], true, failure);
	assert.ok(typeof candidate.verifierId === 'string' && /^sandbox-warm-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(candidate.verifierId), failure);
	assert.equal(candidate.verifierStopped, true, failure);
	assert.ok(typeof candidate.digest === 'string' && /^sha256:[a-f0-9]{64}$/u.test(candidate.digest), failure);
	const repository = result.simulationRepository;
	assert.ok(typeof repository === 'string' && /^\/var\/lib\/treeseed\/agent\/workspaces\/simulations\/[a-f0-9]{64}\.git$/u.test(repository), failure);
	return repository;
}

export function nativePublishedGit(repository: string) {
	assert.ok(isAbsolute(repository), failure);
	assert.equal(realpathSync(repository), repository, failure); assert.ok(lstatSync(repository).isDirectory(), failure);
	assert.equal(existsSync(join(repository, 'objects/info/alternates')), false, failure);
	assert.equal(existsSync(join(repository, 'shallow')), false, failure);
	const git = (args: string[]) => execFileSync('/usr/bin/git', ['--no-replace-objects', `--git-dir=${repository}`,
		'-c', 'core.hooksPath=/dev/null', ...args], { timeout: 5000, maxBuffer: 32 * 1024 * 1024,
		env: { PATH: '/usr/bin:/bin', LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
	assert.equal(git(['rev-parse', '--is-bare-repository']).toString().trim(), 'true', failure);
	return git;
}

/** Resolve the original published assignment branch independently from its journal and result. */
export function verifySdkPublishedBranch(repository: string, reference: AssignmentReference) {
	assert.equal(reference.kind, 'git', failure); assert.ok(reference.kind === 'git');
	assert.ok(typeof reference.branch === 'string' && reference.branch.length > 0, failure);
	assert.match(reference.commit, /^[a-f0-9]{40}$/u, failure);
	const git = nativePublishedGit(repository), ref = `refs/heads/${reference.branch}`;
	git(['check-ref-format', ref]);
	assert.equal(git(['show-ref', '--verify', '--hash', ref]).toString().trim(), reference.commit, failure);
	assert.equal(git(['rev-parse', '--verify', `${reference.commit}^{commit}`]).toString().trim(), reference.commit, failure);
	assert.equal(git(['show-ref', '--verify', '--hash', ref]).toString().trim(), reference.commit, failure);
	return reference.commit;
}

/** Inspect visible committed documentation, rather than metadata or comments alone. */
export function sdkDocumentationBody(bytes: Buffer): string {
	const text = bytes.toString('utf8'); assert.deepEqual(Buffer.from(text), bytes, `${failure}: Documentation must be UTF-8`);
	assert.ok(!text.includes('\0'), `${failure}: Binary documentation denied`);
	return text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, '').replace(/<!--[\s\S]*?-->/gu, '').trim();
}

/** Independent native Git objects prove ancestry and exact approved test bytes. No product code is changed. */
export function verifySdkCommittedTests(repository: string, base: string, tester: string, engineer: string,
	integration?: { writer: string; release: string; writerBase: string }) {
	for (const commit of [base, tester, engineer]) assert.match(commit, /^[a-f0-9]{40}$/u, failure);
	if (integration) {
		for (const commit of [integration.writer, integration.release, integration.writerBase]) assert.ok(typeof commit === 'string' && /^[a-f0-9]{40}$/u.test(commit), failure);
		assert.equal(integration.writerBase, engineer, `${failure}: Writer must start from the independently approved implementation`);
	}
	assert.equal(new Set([base, tester, engineer]).size, 3, failure);
	const git = nativePublishedGit(repository);
	for (const commit of [base, tester, engineer]) assert.equal(git(['rev-parse', '--verify', `${commit}^{commit}`]).toString().trim(), commit, failure);
	git(['merge-base', '--is-ancestor', base, tester]); git(['merge-base', '--is-ancestor', tester, engineer]);
	if (integration) {
		for (const commit of [integration.writer, integration.release])
			assert.equal(git(['rev-parse', '--verify', `${commit}^{commit}`]).toString().trim(), commit, failure);
		git(['merge-base', '--is-ancestor', engineer, integration.writer]);
		const changed = git(['diff', '--name-only', '--no-renames', '-z', engineer, integration.writer]).toString('utf8').split('\0').filter(Boolean);
		assert.ok(changed.every(path => /^(?:[^/]+\.mdx?$|docs\/|examples\/)/u.test(path)),
			`${failure}: Writer must preserve the independently approved implementation and test runner`);
		const docs = changed.filter(path => /^(?:[^/]+\.mdx?|docs\/.+\.mdx?)$/u.test(path));
		let documented = 0;
		for (const path of docs) {
			const entry = git(['ls-tree', '-z', integration.writer, '--', path]).toString('utf8');
			if (!entry) continue; // Removed obsolete pages cannot count as the delivered documentation.
			assert.ok(/^(100644|100755) blob [a-f0-9]{40}\t/u.test(entry), `${failure}: Writer deleted or redirected documentation`);
			const body = sdkDocumentationBody(git(['cat-file', 'blob', `${integration.writer}:${path}`]));
			assert.ok(body && /[\p{L}\p{N}]/u.test(body), `${failure}: Empty documentation is not a delivered product`);
			const previous = git(['ls-tree', '-z', engineer, '--', path]);
			if (previous.length && body === sdkDocumentationBody(git(['cat-file', 'blob', `${engineer}:${path}`]))) continue;
			documented++;
		}
		assert.ok(documented > 0, `${failure}: Actual repository documentation must change`);

		git(['merge-base', '--is-ancestor', integration.writer, integration.release]);
		assert.equal(git(['rev-parse', `${integration.release}^{tree}`]).toString().trim(),
			git(['rev-parse', `${integration.writer}^{tree}`]).toString().trim(), `${failure}: Integration contains unreviewed changes`);
	}
	const implementation = git(['diff', '--name-only', '--no-renames', '-z', tester, engineer]).toString('utf8').split('\0').filter(Boolean);
	assert.ok(implementation.every(path => !path.startsWith('tests/') && !path.startsWith('scripts/')
		&& !['package.json', 'package-lock.json', 'npm-shrinkwrap.json', '.npmrc'].includes(path)
		&& !/^(?:vitest|vite|tsconfig)(?:\.[^/]+)?\.(?:ts|mts|cts|js|mjs|cjs|json)$/u.test(path)),
		`${failure}: Engineer must retain every approved test and the original complete-suite runner`);
	assert.ok(implementation.some(path => /^src\/.*\.ts$/u.test(path)
		&& /^100(?:644|755) blob [a-f0-9]{40}\t/u.test(git(['ls-tree', '-z', engineer, '--', path]).toString('utf8'))),
		`${failure}: Engineer must produce a native source implementation after approved tests`);
	const changed = git(['diff', '--name-only', '--no-renames', '-z', base, tester]).toString('utf8').split('\0').filter(Boolean);
	assert.ok(changed.length > 0 && new Set(changed).size === changed.length, failure);
	assert.ok(changed.every(path => /^tests\//u.test(path) && !path.split('/').some(part => part === '..' || part === '.' || part === '')), failure);
	assert.ok(changed.some(path => /\.(?:test|spec)\.ts$/u.test(path)), failure);
	const tests = changed.map(path => {
		const original = git(['ls-tree', '-z', tester, '--', path]), consumed = git(['ls-tree', '-z', engineer, '--', path]);
		assert.deepEqual(consumed, original, `${failure}: Engineer changed approved test ${path}`);
		if (integration) for (const commit of [integration.writer, integration.release])
			assert.deepEqual(git(['ls-tree', '-z', commit, '--', path]), original, `${failure}: Integrated candidate changed approved test ${path}`);
		const match = /^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)\0$/u.exec(original.toString('utf8'));
		assert.ok(match && match[3] === path, `${failure}: Tester deleted or redirected test ${path}`);
		const blob = git(['cat-file', 'blob', `${tester}:${path}`]);
		assert.deepEqual(git(['cat-file', 'blob', `${engineer}:${path}`]), blob, failure);
		return { path, mode: match[1]!, objectId: match[2]!, digest: createHash('sha256').update(blob).digest('hex') };
	});
	for (const commit of [base, tester, engineer]) assert.equal(git(['rev-parse', '--verify', `${commit}^{commit}`]).toString().trim(), commit, failure);
	return tests;
}

export {verifySdkBaseRed,verifySdkIntentRuntime} from './base-red.ts';

/** Resolve actual Writer documentation bytes from the independently published native Git repository. */
export function verifySdkReferenceDocumentation(repository:string,engineer:string,writer:string):void{
 const label='ACCEPTANCE_SDK_DOCUMENTATION';for(const commit of [engineer,writer])assert.match(commit,/^[a-f0-9]{40}$/u,label);
 const git=nativePublishedGit(repository);git(['merge-base','--is-ancestor',engineer,writer]);
 const paths=git(['diff','--name-only','--no-renames','-z',engineer,writer]).toString('utf8').split('\0').filter(path=>/^(?:[^/]+\.mdx?|docs\/.+\.mdx?)$/u.test(path));
 const documents:string[]=[];for(const path of paths){const entry=git(['ls-tree','-z',writer,'--',path]).toString('utf8');if(!entry)continue;assert.ok(/^100(?:644|755) blob [a-f0-9]{40}\t/u.test(entry),label+': Redirected reference page');documents.push(sdkDocumentationBody(git(['cat-file','blob',writer+':'+path])));}
 verifySdkDocumentationExamples(documents);
 assert.equal(git(['rev-parse',writer+'^{commit}']).toString().trim(),writer,label);
}

