import { test, expect } from 'bun:test';
import { z } from 'zod';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PlatformOperations, PlatformSchemas, ContractProjection, OperationDefinition, InstalledSchemas, InstalledDeclarations } from '../../src/contracts.js';
import { SourcePolicy } from '../../src/source-policy.js';

export class ContractTests {
  readonly hash = 'a'.repeat(64);
  readonly inputs: unknown[] = [{}, {}, { installationId:'local', engineContext:'default', installationDirectory:'/tmp/cordis', origin:'https://localhost:8443', runtimeState:'running', plugins:[{id:'identity',package:'@test/identity',version:'1.0.0',integrity:'a'.repeat(64)}], credentialReferences:['secret://identity'],release:{directory:'/tmp/release',manifestDigest:'a'.repeat(64)} }, {planId:'p1',digest:'a'.repeat(64)}, {id:'a1'}, {id:'a1',limit:10}, {id:'a1',expectedState:'prepare'}];
  readonly outputs: unknown[] = [
    {contractVersion:'0.1.0-cordis.1',platformVersion:'0.0.0-cordis.1',schemaDigest:'a'.repeat(64),plugins:[],operations:['platform.describe']},
    {installationId:'local',engine:'default',desiredComposition:null,activeComposition:null,ready:false,plugins:[],blockers:[],applicationId:null},
    {formatVersion:1,id:'plan-'+this.hash,digest:this.hash,configuration:this.inputs[2],recipe:{services:{},volumes:{},secrets:{}},pluginBindings:[],configurationDigest:this.hash,releaseDigest:this.hash,recipeDigest:this.hash,lockDigest:this.hash,expectedEngine:{context:'default',endpoint:'unix:///var/run/docker.sock',daemonId:'fixture',os:'linux',architecture:'amd64'},expectedComposition:null,projectName:'cordis-'+this.hash.slice(0,16),artifacts:[],effects:[],blockers:[]},
    {id:'a1',accepted:true},
    {id:'a1',phase:'prepare',desiredComposition:'a'.repeat(64),activeComposition:null,result:null,recovery:null,historyReference:null},
    {events:[{sequence:1,cursor:'1',phase:'prepare',message:'preparing'}],nextCursor:null},
    {id:'a1',cancellationRequested:true,phase:'prepare'}
  ];
  static id(operation: typeof PlatformOperations.all[number]): string { return operation.definition.id; }
  badInput():void {OperationDefinition.define({...PlatformOperations.describe.definition,input:z.object({})});}
  badOutput():void {OperationDefinition.define({...PlatformOperations.describe.definition,output:z.any()});}
  badWrite():void {OperationDefinition.define({...PlatformOperations.apply.definition,idempotency:false});}
  duplicate():void {PlatformOperations.validate([...PlatformOperations.all,PlatformOperations.describe]);}
  badTool():void {OperationDefinition.define({...PlatformOperations.describe.definition,mcp:'collision'});}
}
