import { sortWorkspacePackages, workspacePackages, run } from '../src/operations/services/workspace-tools.ts';

const packages = sortWorkspacePackages(workspacePackages());

for (const pkg of packages) {
	const scripts = pkg.packageJson.scripts ?? {};
	const scriptName = typeof scripts['test:release'] === 'string'
		? 'test:release'
		: typeof scripts['test:unit'] === 'string'
			? 'test:unit'
			: typeof scripts.test === 'string'
				? 'test'
				: null;

	if (scriptName) {
		const startedAt = Date.now();
		process.stderr.write(`[workspace-release-test] ${pkg.name ?? pkg.dir} ${scriptName} start\n`);
		run('npm', ['run', scriptName], { cwd: pkg.dir });
		process.stderr.write(`[workspace-release-test] ${pkg.name ?? pkg.dir} ${scriptName} complete after ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
	}
}
