import { existsSync } from 'node:fs';
import path from 'node:path';

function findContentRoot(start: string) {
	let current = path.resolve(start);
	for (;;) {
		if (existsSync(path.join(current, 'src', 'content'))) {
			return current;
		}
		if (existsSync(path.join(current, 'docs', 'src', 'content'))) {
			return path.join(current, 'docs');
		}

		const parent = path.dirname(current);
		if (parent === current) {
			return null;
		}
		current = parent;
	}
}

export function resolveSdkRepoRoot(repoRoot?: string) {
	if (repoRoot) {
		return path.resolve(repoRoot);
	}

	if (process.env.TREESEED_SDK_REPO_ROOT) {
		return path.resolve(process.env.TREESEED_SDK_REPO_ROOT);
	}

	return findContentRoot(process.cwd()) ?? process.cwd();
}
