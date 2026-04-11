import { packageScriptPath, runNodeScript } from '../src/operations/services/runtime-tools.ts';

runNodeScript(packageScriptPath('cleanup-markdown'), ['--check'], {
	cwd: process.cwd(),
});
