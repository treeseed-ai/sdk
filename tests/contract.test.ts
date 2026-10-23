import { test, expect } from 'bun:test';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PlatformOperations, PlatformSchemas, ContractProjection, OperationDefinition } from '../src/contracts.js';
import { SourcePolicy } from '../src/source-policy.js';

class ContractTests {
  readonly hash = 'a'.repeat(64);
  readonly inputs: unknown[] = [{}, {}, { installationId:'local', engineContext:'default', installationDirectory:'/tmp/cordis', origin:'https://localhost:8443', runtimeState:'running', plugins:[{id:'identity',package:'@test/identity',version:'1.0.0',integrity:'a'.repeat(64)}], credentialReferences:['secret://local/identity'] }, {planId:'p1',digest:'a'.repeat(64)}, {id:'a1'}, {id:'a1',limit:10}, {id:'a1',expectedState:'prepare'}];
  readonly outputs: unknown[] = [
    {contractVersion:'0.1.0-cordis.1',platformVersion:'0.0.0-cordis.1',schemaDigest:'a'.repeat(64),plugins:[],operations:['platform.describe']},
    {installationId:'local',engine:'default',desiredComposition:null,activeComposition:null,ready:false,plugins:[],blockers:[],applicationId:null},
    {id:'p1',digest:'a'.repeat(64),expectedComposition:null,artifacts:[],effects:['persist plan'],blockers:[]},
    {id:'a1',accepted:true},
    {id:'a1',phase:'prepare',desiredComposition:'a'.repeat(64),activeComposition:null,result:null,recovery:null,historyReference:null},
    {events:[{sequence:1,cursor:'1',phase:'prepare',message:'preparing'}],nextCursor:null},
    {id:'a1',cancellationRequested:true,phase:'prepare'}
  ];
  artifact(): void {
    const projection = JSON.parse(readFileSync('dist/contract.json','utf8'));
    expect(projection).toEqual(ContractProjection.generate());
    const script = "import {PlatformOperations} from './dist/src/contracts.js'; class Probe { static run(){ if(PlatformOperations.all.length!==7)process.exit(1); PlatformOperations.all[0].parseInput({}); } } Probe.run();";
    const result=spawnSync('node',['--input-type=module','-e',script],{encoding:'utf8'});
    expect(result.stderr).toBe(''); expect(result.status).toBe(0);
  }
  schemaBoundary(): void {
    expect(PlatformOperations.all.map(ContractTests.id)).toEqual(['platform.describe','platform.status','platform.plan','platform.apply','platform.applications.get','platform.applications.events','platform.applications.cancel']);
    for(let index=0;index<7;index++) {
      const operation=PlatformOperations.all[index]!;
      expect<unknown>(operation.parseInput(this.inputs[index])).toEqual(this.inputs[index]);
      expect<unknown>(operation.parseOutput(this.outputs[index])).toEqual(this.outputs[index]);
      expect(operation.definition.input.safeParse({...this.inputs[index] as object,principal:'forged'}).success).toBe(false);
      expect(operation.definition.output.safeParse({...this.outputs[index] as object,extra:true}).success).toBe(false);
      expect(operation.definition.output.safeParse({}).success).toBe(false);
      expect(operation.definition.input.safeParse(null).success).toBe(false);
    }
  }
  static id(operation: typeof PlatformOperations.all[number]): string { return operation.definition.id; }
  invalidFields(): void {
    for (const value of [{id:''},{id:'a',limit:0},{id:'a',limit:1.5},{id:'a',limit:1001},{id:'a',cursor:''}]) expect(PlatformOperations.events.definition.input.safeParse(value).success).toBe(false);
    expect(PlatformOperations.apply.definition.input.safeParse({planId:'p',digest:'latest'}).success).toBe(false);
    expect(PlatformOperations.plan.definition.input.safeParse({...this.inputs[2] as object,origin:'https://remote.example'}).success).toBe(false);
    expect(PlatformOperations.plan.definition.input.safeParse({...this.inputs[2] as object,credentialReferences:['plaintext-password']}).success).toBe(false);
    expect(PlatformSchemas.configuration.safeParse({port:0}).success).toBe(false);
    expect(PlatformSchemas.configuration.safeParse({installationDirectory:'relative'}).success).toBe(false);
  }
  policies(): void {
    for(const operation of PlatformOperations.all) {
      const definition=operation.definition;
      expect(definition.mcp).toBe(definition.id.replaceAll('.','_'));
      expect(definition.exposure).toEqual(['rest','cli','mcp']);
      expect(definition.scope).toBe(definition.effect==='read'?'platform.read':'platform.manage');
      expect(definition.idempotency).toBe(definition.effect==='write');
    }
    expect(PlatformOperations.plan.definition.effect).toBe('write');
    expect(this.badWrite.bind(this)).toThrow();
    expect(this.duplicate.bind(this)).toThrow();
    expect(this.badTool.bind(this)).toThrow();
  }
  badWrite():void {OperationDefinition.define({...PlatformOperations.apply.definition,idempotency:false});}
  duplicate():void {PlatformOperations.validate([...PlatformOperations.all,PlatformOperations.describe]);}
  badTool():void {OperationDefinition.define({...PlatformOperations.describe.definition,mcp:'collision'});}
  sourcePolicy(): void {
    const policy=new SourcePolicy();
    expect(policy.inspect('okay.ts','export class A { run(): number { return 1; } } export interface B { run(): void; }')).toEqual([]);
    const cases: [string,string][]=[['bad.js','class A {}'],['bad.ts','export function bad() {}'],['bad.mts','export function bad() {}'],['bad.cts','const bad = () => 1;'],['bad.ts','const bad = () => 1;'],['bad.ts','const factory = function() { return {}; };'],['bad.tsx','const UI = () => <div/>;'],['bad.ts','const bag = {run() { return 1; }};'],['bad.ts',"export {Thing} from '../../other/src/main';"]];
    for(const [name,source] of cases) expect(policy.inspect(name,source).length).toBeGreaterThan(0);
    const directory=mkdtempSync(join(tmpdir(),'cordis-source-'));
    try { writeFileSync(join(directory,'hidden.js'),'class Bad {}'); expect(policy.check.bind(policy,directory)).toThrow('handwritten'); }
    finally {rmSync(directory,{recursive:true,force:true});}
  }
}
const suite=new ContractTests();
test('smoke: built portable Node artifact and schema projection',suite.artifact.bind(suite));
test('integration: all seven strict public schema boundaries',suite.schemaBoundary.bind(suite));
test('unit: reject invalid fields and authority input',suite.invalidFields.bind(suite));
test('unit: effect and exposure policy',suite.policies.bind(suite));
test('unit: semantic class architecture enforcement',suite.sourcePolicy.bind(suite));
