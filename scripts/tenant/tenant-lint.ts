import { packageScriptPath, runNodeScript } from '../../src/operations/services/agents/runtime-tools.ts';

runNodeScript(packageScriptPath('maintenance/cleanup-markdown'), ['--check'], {
	cwd: process.cwd(),
});
