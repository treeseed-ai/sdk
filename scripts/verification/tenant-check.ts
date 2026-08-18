import { resolveAstroBin, createProductionBuildEnv, packageScriptPath, runNodeBinary, runNodeScript } from '../../src/operations/services/agents/runtime-tools.ts';

runNodeScript(packageScriptPath('content/patch-starlight-content-path'), [], { cwd: process.cwd() });
runNodeBinary(resolveAstroBin(), ['check'], {
	cwd: process.cwd(),
	env: createProductionBuildEnv(),
});
