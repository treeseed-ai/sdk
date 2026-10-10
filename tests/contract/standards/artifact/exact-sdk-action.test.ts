import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from 'yaml';
import ts from 'typescript';

const action = () => parse(readFileSync('.github/actions/install-exact-sdk/action.yml', 'utf8'));
const source = '7'.repeat(40), outer = '9'.repeat(40);
it('the exact SDK artifact input overrides an unrelated enclosing action ref through the same validated installer', () => {
 const declared = action();
 expect(declared.inputs.commit).toEqual({ description: 'Exact SDK artifact commit; required when invoked by another composite action.', required: false });
 expect(declared.runs.steps).toHaveLength(1);
 expect(declared.runs.steps[0].env.TREESEED_SDK_COMMIT).toBe('${{ inputs.commit || github.action_ref }}');
 expect(declared.runs.steps[0].run).toContain('SDK commit must be an exact 40-character lowercase SHA.');
 expect(declared.runs.steps[0].run).toContain('test -d "${package_path}/dist"');
 expect(declared.runs.steps[0].run).toContain('--ignore-scripts');
});

it('native exact SDK installation consumes the held archive at the explicit commit and denies malformed authority before any GitHub command', () => {
 const declared = action();
 expect(declared.runs.steps[0].env.TREESEED_SDK_COMMIT).toBe('${{ inputs.commit || github.action_ref }}');
 const root = mkdtempSync(resolve(tmpdir(), 'sdk-action-custody-')),deadline = performance.now() + 14_000;
 const archiveRoot = resolve(root, 'artifact'),fixture = resolve(root, 'fixture'),bin = resolve(root, 'bin'),installed = resolve(root, 'installed');
 const native = (command: string, args: string[], env: NodeJS.ProcessEnv = process.env, cwd = root) => {
  const timeout = Math.floor(deadline - performance.now()); expect(timeout).toBeGreaterThan(0);
  const options = { cwd, env, encoding: 'utf8' as const, timeout, killSignal: 'SIGKILL' as const, detached: true, maxBuffer: 8 * 1024 * 1024 };
  const result = spawnSync(command, args, options);
  if (result.pid) try { process.kill(-result.pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  expect(result.error).toBeUndefined();expect(result.signal).toBeNull();return result;
 };
 try {
  for (const path of [archiveRoot,resolve(fixture,'dist'),bin]) mkdirSync(path,{recursive:true});
  writeFileSync(resolve(fixture,'package.json'),JSON.stringify({name:'@treeseed/sdk',version:'0.0.0-fixture',type:'module',files:['dist'],exports:{'./operator-contracts':'./dist/operator-contracts.js'}}));
  const bytes=`export const exact=${JSON.stringify(source)};\n`;writeFileSync(resolve(fixture,'dist/operator-contracts.js'),bytes);
  const packed=native('npm',['pack','--ignore-scripts','--json','--pack-destination',archiveRoot],process.env,fixture);expect(packed.status,packed.stderr).toBe(0);
  const archive=resolve(archiveRoot,JSON.parse(packed.stdout)[0].filename),held=readFileSync(archive),calls=resolve(root,'calls.jsonl');
  const githubSource=`import{appendFileSync,copyFileSync}from'node:fs';import{resolve}from'node:path';
const args=process.argv.slice(2);appendFileSync(process.env.FIXTURE_CALLS!,JSON.stringify(args)+'\\n');
if(args[0]==='api'){if(!args[1]?.includes('sdk-'+process.env.FIXTURE_COMMIT!))throw new Error('Wrong artifact authority');process.stdout.write('42');}
else if(args[0]==='run'&&args[1]==='view')process.stdout.write(process.env.FIXTURE_COMMIT+' completed success');
else if(args[0]==='run'&&args[1]==='download'){if(!args.includes('sdk-'+process.env.FIXTURE_COMMIT!))throw new Error('Wrong download');copyFileSync(process.env.FIXTURE_ARCHIVE!,resolve(args[args.indexOf('--dir')+1]!,'held.tgz'));}
else throw new Error('Unexpected GitHub command');`;
  writeFileSync(resolve(bin,'gh'),`#!/usr/bin/env node\n${ts.transpileModule(githubSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText}`);chmodSync(resolve(bin,'gh'),0o755);
  const env={...process.env,PATH:`${bin}:${dirname(process.execPath)}:${process.env.PATH}`,NODE_ENV:'production',TREESEED_SDK_COMMIT:source,TREESEED_SDK_PATHS:resolve(installed,'node_modules/@treeseed/sdk'),FIXTURE_CALLS:calls,FIXTURE_COMMIT:source,FIXTURE_ARCHIVE:archive,GH_TOKEN:'fixture-only'};
  const accepted=native('bash',['-c',declared.runs.steps[0].run],env);expect(accepted.status,accepted.stderr).toBe(0);
  expect(readFileSync(resolve(env.TREESEED_SDK_PATHS,'dist/operator-contracts.js'),'utf8')).toBe(bytes);
  const observed=readFileSync(calls,'utf8');expect(observed).toContain(`sdk-${source}`);expect(observed).not.toContain(outer);
  const imported=native(process.execPath,['--input-type=module','-e',"import{exact}from'@treeseed/sdk/operator-contracts';process.stdout.write(exact)"],env,installed);expect(imported.status,imported.stderr).toBe(0);expect(imported.stdout).toBe(source);
  for (const commit of ['', 'staging', outer.toUpperCase().replace('9','A'), '../'+source, source+'\n']) {
   const denied=native('bash',['-c',declared.runs.steps[0].run],{...env,TREESEED_SDK_COMMIT:commit});
   expect(denied.status).toBe(1);expect(denied.stderr).toContain('SDK commit must be an exact 40-character lowercase SHA.');expect(readFileSync(calls,'utf8')).toBe(observed);
  }
  expect(readFileSync(archive)).toEqual(held);expect(readFileSync(resolve(env.TREESEED_SDK_PATHS,'dist/operator-contracts.js'),'utf8')).toBe(bytes);
 } finally {rmSync(root,{recursive:true,force:true});expect(existsSync(root)).toBe(false);expect(performance.now()).toBeLessThan(deadline);}
});
