import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
class ServiceIntentTestsUnit {

    async bounded():Promise<void>{const {PluginManagementSchemas}=await import('../../src/management.js'),bindings:Record<string,string>={};for(let index=0;index<257;index++)bindings['port-'+index]='binding-'+index;expect(PluginManagementSchemas.install.safeParse({source:'fixture',idempotencyKey:'bound',installationDirectory:'/tmp/fixture',scope:'installation',target:'deployment',bindings,configuration:{}}).success).toBe(false);expect(PluginManagementSchemas.select.safeParse({capability:'container.service',providerId:'fixture',idempotencyKey:'scope',installationDirectory:'/tmp/fixture',scope:'client',target:'deployment',serviceId:'one',configuration:{}}).success).toBe(false);}

    async projection():Promise<void>{const {ContractProjection}=await import('../../src/contracts.js'),contract=ContractProjection.generate() as {schemas:{pluginInstall:{allOf:unknown;properties:{bindings:{maxProperties?:number}}};pluginSelect:{allOf:unknown}}},expected=[{if:{anyOf:[{required:['serviceId']},{required:['bindings']}]},then:{properties:{scope:{const:'installation'},target:{const:'deployment'}},required:['target']}}];expect(contract.schemas.pluginInstall.allOf).toEqual(expected);expect(contract.schemas.pluginSelect.allOf).toEqual(expected);expect(contract.schemas.pluginInstall.properties.bindings.maxProperties).toBe(256);}
}
const intent=new ServiceIntentTestsUnit();
test('unit: emitted install and selection schemas enforce the conditional service scope',intent.projection.bind(intent));
test('unit: service binding intent is bounded and selection cannot escape installation scope',intent.bounded.bind(intent));
