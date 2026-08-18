import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type RepositoryFixture = { origin: string };
type GitRunner = (cwd: string, args: string[]) => string;

export function materializeWorkflowRepositories(input: {
	work: string;
	materialization: 'gitlinks' | 'workset';
	repositories: Record<string, RepositoryFixture>;
	git: GitRunner;
	gitAllowFile: GitRunner;
}) {
	if (input.materialization === 'gitlinks') {
		for (const [name, repository] of Object.entries(input.repositories)) {
			input.gitAllowFile(input.work, ['submodule', 'add', repository.origin, `packages/${name}`]);
		}
		return;
	}

	writeFileSync(resolve(input.work, '.gitignore'), '/packages/\n/.treeseed/\n/node_modules/\n', 'utf8');
	const completed = Object.entries(input.repositories).map(([name, repository]) => {
		const path = `packages/${name}`;
		input.gitAllowFile(input.work, ['clone', repository.origin, path]);
		const commit = input.git(resolve(input.work, path), ['rev-parse', 'HEAD']);
		return { projectId: `project-${name}`, role: 'primary', path, repository: `file://${repository.origin}`, sourceBranch: 'main', commit, branch: null, action: 'noop', reason: 'Fixture workset materialized.' };
	});
	const receiptPath = resolve(input.work, '.treeseed', 'worksets', 'platform', 'latest.json');
	const inventoryDigest = createHash('sha256').update(JSON.stringify(completed.map(({ projectId, role, path, repository, sourceBranch, commit }) =>
		({ projectId, role, path, repository, branch: sourceBranch, commit })))).digest('hex');
	mkdirSync(dirname(receiptPath), { recursive: true });
	writeFileSync(receiptPath, `${JSON.stringify({ schemaVersion: 1, kind: 'treeseed.platform-workset-receipt', status: 'verified', teamId: 'team-fixture', branch: null, inventoryDigest, completed }, null, 2)}\n`, 'utf8');
}
