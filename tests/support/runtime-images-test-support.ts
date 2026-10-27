import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {PackageDefinition,PluginManagementSchemas,ProviderV4Schemas,PlatformSchemas} from '../../src/contracts.js';
export class RuntimePlugin {
 static readonly provide=['fixture.runtime'];static readonly inject:string[]=[];static readonly Config=PlatformSchemas.empty;
 static readonly declaration=ProviderV4Schemas.declaration.parse({id:'fixture.runtime',pluginId:'fixture',capability:'fixture.runtime',target:'deployment',contractVersion:ProviderV4Schemas.version,provide:this.provide,inject:this.inject});
 static readonly replacement={kind:'restart',stateVersion:1,qualificationDigest:null};
}
