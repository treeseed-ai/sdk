import { sortWorkspacePackages, workspacePackages, run } from '../src/operations/services/workspace-tools.ts';

const packages = sortWorkspacePackages(workspacePackages());

for (const pkg of packages) {
	if (typeof pkg.packageJson.scripts?.['test:unit'] === 'string') {
		const startedAt = Date.now();
		process.stderr.write(`[workspace-test] ${pkg.name ?? pkg.dir} test:unit start\n`);
		run('npm', ['run', 'test:unit'], { cwd: pkg.dir });
		process.stderr.write(`[workspace-test] ${pkg.name ?? pkg.dir} test:unit complete after ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
		continue;
	}

	if (typeof pkg.packageJson.scripts?.test === 'string') {
		const startedAt = Date.now();
		process.stderr.write(`[workspace-test] ${pkg.name ?? pkg.dir} test start\n`);
		run('npm', ['run', 'test'], { cwd: pkg.dir });
		process.stderr.write(`[workspace-test] ${pkg.name ?? pkg.dir} test complete after ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
	}
}
