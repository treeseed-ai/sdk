import { packagesWithScript, run } from '../src/operations/services/workspace-tools.ts';

for (const pkg of packagesWithScript('test:unit')) {
	run('npm', ['run', 'test:unit'], { cwd: pkg.dir });
}
