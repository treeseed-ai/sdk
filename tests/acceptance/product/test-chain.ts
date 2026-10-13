import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { assignmentReferenceSchema, type AssignmentAttempt, type AssignmentReference } from '@treeseed/sdk/agent-capacity';
import { sourceWorkspaceKeySchema } from '@treeseed/sdk/capacity-provider/sandbox';

export type PublishedSourceAttempt = Pick<AssignmentAttempt, 'id' | 'teamId' | 'projectId' | 'attempt' | 'workspace'>
	& { provider: Pick<AssignmentAttempt['provider'], 'providerId'> };

const failure = 'ACCEPTANCE_SDK_NATIVE_TEST_CHAIN';
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
	const repository = result.simulationRepository;
	assert.ok(typeof repository === 'string' && /^\/var\/lib\/treeseed\/agent\/workspaces\/simulations\/[a-f0-9]{64}\.git$/u.test(repository), failure);
	return repository;
}

function nativePublishedGit(repository: string) {
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

/** Independent native Git objects prove ancestry and exact approved test bytes. No product code is changed. */
export function verifySdkCommittedTests(repository: string, base: string, tester: string, engineer: string) {
	for (const commit of [base, tester, engineer]) assert.match(commit, /^[a-f0-9]{40}$/u, failure);
	assert.equal(new Set([base, tester, engineer]).size, 3, failure);
	const git = nativePublishedGit(repository);
	for (const commit of [base, tester, engineer]) assert.equal(git(['rev-parse', '--verify', `${commit}^{commit}`]).toString().trim(), commit, failure);
	git(['merge-base', '--is-ancestor', base, tester]); git(['merge-base', '--is-ancestor', tester, engineer]);
	const implementation = git(['diff', '--name-only', '--no-renames', '-z', tester, engineer]).toString('utf8').split('\0').filter(Boolean);
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
		const match = /^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)\0$/u.exec(original.toString('utf8'));
		assert.ok(match && match[3] === path, `${failure}: Tester deleted or redirected test ${path}`);
		const blob = git(['cat-file', 'blob', `${tester}:${path}`]);
		assert.deepEqual(git(['cat-file', 'blob', `${engineer}:${path}`]), blob, failure);
		return { path, mode: match[1]!, objectId: match[2]!, digest: createHash('sha256').update(blob).digest('hex') };
	});
	for (const commit of [base, tester, engineer]) assert.equal(git(['rev-parse', '--verify', `${commit}^{commit}`]).toString().trim(), commit, failure);
	return tests;
}
