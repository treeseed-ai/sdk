import { packageScriptPath } from '../src/operations/services/runtime-tools.ts';
import { packagesWithScript, run, workspaceRoot } from '../src/operations/services/workspace-tools.ts';

const root = workspaceRoot();

process.stderr.write('[workspace-lint] markdown cleanup check start\n');
const markdownStartedAt = Date.now();
run(process.execPath, [packageScriptPath('cleanup-markdown'), '--check'], {
	cwd: root,
});
process.stderr.write(`[workspace-lint] markdown cleanup check complete after ${((Date.now() - markdownStartedAt) / 1000).toFixed(1)}s\n`);

for (const pkg of packagesWithScript('lint', root)) {
	const startedAt = Date.now();
	process.stderr.write(`[workspace-lint] ${pkg.name ?? pkg.dir} lint start\n`);
	run('npm', ['run', 'lint'], { cwd: pkg.dir });
	process.stderr.write(`[workspace-lint] ${pkg.name ?? pkg.dir} lint complete after ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
}
