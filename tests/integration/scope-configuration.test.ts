import {spawnSync} from 'node:child_process';
import {test,expect} from 'bun:test';
import {z} from 'zod';
import {Context,CordisComposition,type ProviderRegistration} from '../../src/composition.js';
import {CapabilityToken,ProviderV4Schemas} from '../../src/schemas.js';
import {Value,ValueValidation,token,ValuePlugin,NextPlugin,ScopeTests,TransformValues,TransformPlugin,ScopeBoundaryTests,FailedValuePlugin,ScopeFailureTests,DisposalGate,SlowDisposalPlugin,ConfigurationFault,InvalidConfigurationPlugin} from '../support/scope-test-support.js';
class ConfigurationFailureTestsIntegration {
async safe():Promise<void>{const {CordisScope}=await import('../../src/composition.js');const authority={scopeId:'fixture',target:'cli' as const,principalId:'owner',resourceScope:'fixture'},registration={token,plugin:ValuePlugin,declaration:ValuePlugin.declaration,configuration:{},artifact:{kind:'bundled' as const,identity:'fixture'}},scope=await CordisScope.start({registrations:[registration],selections:[{scopeId:'fixture',capability:token.id,providerId:ValuePlugin.declaration.id}]},authority);try{const next={...registration,plugin:InvalidConfigurationPlugin,declaration:InvalidConfigurationPlugin.declaration,configuration:{label:'input'}};await expect(scope.beginReplacement({registrations:[next],selections:[{scopeId:'fixture',capability:token.id,providerId:next.declaration.id}]},scope.generation,100)).rejects.toThrow('INVALID_PROVIDER_CONFIGURATION');const lease=await scope.acquire(token);await lease.release();}finally{await scope.dispose();}}
}
const configurations=new ConfigurationFailureTestsIntegration();
test("integration: native replacement configuration exceptions are safe and preserve admission",configurations.safe.bind(configurations));
