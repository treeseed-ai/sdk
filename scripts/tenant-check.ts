import { resolveAstroBin, createProductionBuildEnv, packageScriptPath, runNodeBinary, runNodeScript } from '../src/operations/services/runtime-tools.ts';

const publishedRuntime = process.env.TREESEED_CONTENT_SERVING_MODE === 'published_runtime';

runNodeScript(packageScriptPath('patch-starlight-content-path'), [], { cwd: process.cwd() });
if (!publishedRuntime) {
	runNodeScript(packageScriptPath('aggregate-book'), [], { cwd: process.cwd() });
}
runNodeBinary(resolveAstroBin(), ['check'], {
	cwd: process.cwd(),
	env: createProductionBuildEnv(),
});
