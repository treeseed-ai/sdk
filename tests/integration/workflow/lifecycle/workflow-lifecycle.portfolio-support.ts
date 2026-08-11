import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type RepositoryFixture = { origin: string };
type GitRunner = (cwd: string, args: string[]) => string;

export function materializeWorkflowRepositories(input: {
	work: string;
	materialization: 'gitlinks' | 'portfolio';
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
	const repositories = Object.entries(input.repositories).map(([name, repository]) => {
		const path = `packages/${name}`;
		input.gitAllowFile(input.work, ['clone', repository.origin, path]);
		return { path, repository: `file://${repository.origin}`, commit: input.git(resolve(input.work, path), ['rev-parse', 'HEAD']) };
	});
	writeFileSync(resolve(input.work, 'treeseed.portfolio.json'), `${JSON.stringify({
		schemaVersion: 1,
		kind: 'treeseed.portfolio',
		materialization: 'ephemeral_workset',
		integrationAuthority: 'treeseed.integration-change-set/v1',
		repositories,
	}, null, 2)}\n`, 'utf8');
}
