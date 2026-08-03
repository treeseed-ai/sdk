import { relative,resolve,sep } from 'node:path';
import { discoverManagedRepositories } from '../support/managed-repositories.ts';
import { gitStatusPorcelain } from '../treedx/workspaces/workspace-save.ts';
import { runRepositoryGit } from '../operations/git-runner.ts';

function gitOutput(cwd: string, args: string[]) {
	return runRepositoryGit(args, { cwd, mode: 'read', allowFailure: true }).stdout.trim();
}

function gitOk(cwd: string, args: string[]) {
	return runRepositoryGit(args, { cwd, mode: 'read', allowFailure: true }).status === 0;
}

export function reconcileCleanDetachedSubmodules(root: string) {
	const repositories = discoverManagedRepositories(root);
	const parents = repositories.filter((repository) => repository.kind !== 'fixture');
	const repaired: Array<{ name: string; from: string; to: string }> = [];
	for (const repository of repositories.filter((candidate) => candidate.kind === 'fixture' && candidate.detached)) {
		if (gitStatusPorcelain(repository.dir).length > 0) continue;
		const parent = parents
			.filter((candidate) => repository.dir.startsWith(`${resolve(candidate.dir)}${sep}`))
			.sort((left, right) => right.dir.length - left.dir.length)[0];
		if (!parent) continue;
		const submodulePath = relative(parent.dir, repository.dir).split(sep).join('/');
		const expected = gitOutput(parent.dir, ['rev-parse', `HEAD:${submodulePath}`]);
		const current = gitOutput(repository.dir, ['rev-parse', 'HEAD']);
		if (!/^[0-9a-f]{40}$/u.test(expected) || expected === current) continue;
		if (!gitOk(repository.dir, ['cat-file', '-e', `${expected}^{commit}`])) {
			runRepositoryGit(['fetch', 'origin'], { cwd: repository.dir, mode: 'mutate', allowFailure: true });
		}
		if (!gitOk(repository.dir, ['cat-file', '-e', `${expected}^{commit}`])) continue;
		runRepositoryGit(['checkout', '--detach', expected], { cwd: repository.dir, mode: 'mutate' });
		repaired.push({ name: repository.name, from: current, to: expected });
	}
	return repaired;
}
