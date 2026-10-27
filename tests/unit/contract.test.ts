import { test, expect } from 'bun:test';
import { z } from 'zod';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PlatformOperations, PlatformSchemas, ContractProjection, OperationDefinition, InstalledSchemas, InstalledDeclarations } from '../../src/contracts.js';
import { SourcePolicy } from '../../src/source-policy.js';
import {ContractTests} from '../support/contract-test-support.js';
class ContractTestsUnit extends ContractTests {

  installedBoundaries():void {
    const request={protocol:2 as const,operation:'submit' as const,planId:'plan-'+this.hash,digest:this.hash,idempotencyKey:'attempt-1'};
    expect(InstalledSchemas.request.parse(request)).toEqual(request);
    for(const extra of [{principal:'forged'},{command:['sh','-c','canary']},{installationDirectory:'/other'},{operation:'exec'},{protocol:1},{idempotencyKey:''}])expect(InstalledSchemas.request.safeParse({...request,...extra}).success).toBe(false);
    const services=[];
    for(const role of ['database','identity','api','edge'])services.push({role,definition:{role,service:{user:'image-default',workerSocket:false,volumes:[],secrets:[],portTarget:null},slots:{},readiness:{kind:'http-json',path:'/ready',expected:{}}},provider:InstalledDeclarations.service(role,'container.'+role,['deployment.engine']),imageId:role,package:null,entry:null});
    const composition={profile:'first-installed',assetDigest:this.hash,worker:{path:'trsd',sha256:this.hash,size:123},services};
    expect(InstalledSchemas.composition.safeParse(composition).success).toBe(true);
    const definition=structuredClone(services[0]!.definition);expect(InstalledSchemas.definition.safeParse({...definition,service:{...definition.service,environment:{PASSWORD:'plaintext'}}}).success).toBe(false);expect(InstalledSchemas.slotDefinition.safeParse({kind:'random',value:'secret'}).success).toBe(false);
    expect(InstalledSchemas.composition.safeParse({...composition,services:[services[0],services[0],services[2],services[3]]}).success).toBe(false);
    expect(InstalledSchemas.composition.safeParse({...composition,worker:{...composition.worker,path:'../escape'}}).success).toBe(false);
    expect(InstalledSchemas.plan.safeParse(this.outputs[2]).success).toBe(false);
    expect(PlatformSchemas.plan.safeParse({...this.outputs[2] as object,formatVersion:2,composition}).success).toBe(false);
    expect(InstalledSchemas.receipt.safeParse({formatVersion:2,installationId:'local',installationDirectory:'/tmp/install',ownerUid:1000,expectedEngine:{context:'default',endpoint:'unix:///var/run/docker.sock',daemonId:'daemon',os:'linux',architecture:'amd64'},migration:{from:1,receiptSha256:this.hash}}).success).toBe(true);
  }

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
    expect(this.badInput.bind(this)).toThrow();expect(this.badOutput.bind(this)).toThrow();
    const envelope={command:'doctor',success:true,result:null,problem:{code:'bad',title:'bad',detail:'bad'},blockers:[],references:[]};
    expect(PlatformSchemas.envelope.safeParse(envelope).success).toBe(false);
    expect(PlatformSchemas.envelope.safeParse({...envelope,success:false,problem:null}).success).toBe(false);
  }

  sourcePolicy(): void {
    const policy=new SourcePolicy();
    expect(policy.inspect('okay.ts','export class A { run(): number { return 1; } } export interface B { run(): void; } class Loader { async run() { return import("node:fs"); } }')).toEqual([]);
    const cases: [string,string][]=[['bad.js','class A {}'],['bad.ts','export function bad() {}'],['bad.mts','export function bad() {}'],['bad.cts','const bad = () => 1;'],['bad.ts','const bad = () => 1;'],['bad.ts','const factory = function() { return {}; };'],['bad.tsx','const UI = () => <div/>;'],['bad.ts','const bag = {run() { return 1; }};'],['bad.ts',"export {Thing} from '../../other/src/main';"],['bad.ts',"class Bad { async load() {return import('../../other/src/main');} }"],['bad.ts',"class Bad {load() {return require('../../other/src/main');}}"],['bad.ts',"import Bad = require('../../other/src/main');"],['bad.ts',"class Bad {load(path:string) {return import(path);}}"]];
    for(const [name,source] of cases) expect(policy.inspect(name,source).length).toBeGreaterThan(0);
    const directory=mkdtempSync(join(tmpdir(),'cordis-source-'));
    try { writeFileSync(join(directory,'hidden.js'),'class Bad {}'); expect(policy.check.bind(policy,directory)).toThrow('handwritten'); }
    finally {rmSync(directory,{recursive:true,force:true});}
    const nested=mkdtempSync(join(tmpdir(),'cordis-nested-'));
    try {mkdirSync(join(nested,'src/vendor'),{recursive:true});writeFileSync(join(nested,'src/vendor/hidden.js'),'class Hidden {}');expect(policy.check.bind(policy,nested)).toThrow('handwritten');}
    finally {rmSync(nested,{recursive:true,force:true});}
  }
}
const suite=new ContractTestsUnit();
test('unit: reject invalid fields and authority input',suite.invalidFields.bind(suite));
test('unit: effect and exposure policy',suite.policies.bind(suite));
test('unit: semantic class architecture enforcement',suite.sourcePolicy.bind(suite));
test('unit: installed protocol rejects authority and commands and preserves historical formats',suite.installedBoundaries.bind(suite));
