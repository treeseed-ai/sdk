import {spawnSync} from 'node:child_process';
import {test,expect} from 'bun:test';
import {z} from 'zod';
import {Context,CordisComposition,type ProviderRegistration} from '../../src/composition.js';
import {CapabilityToken,ProviderV4Schemas} from '../../src/schemas.js';
import {Value,ValueValidation,token,ValuePlugin,NextPlugin,ScopeTests,TransformValues,TransformPlugin,ScopeBoundaryTests,FailedValuePlugin,ScopeFailureTests,DisposalGate,SlowDisposalPlugin,ConfigurationFault,InvalidConfigurationPlugin} from '../support/scope-test-support.js';
class ScopeTestsIntegration extends ScopeTests {

 async defaults():Promise<void>{const first=await CordisComposition.start(this.descriptor(),this.authority()),second=await CordisComposition.start(this.descriptor(false,{label:'default'}),this.authority());try{expect(first.generation).toBe(second.generation);}finally{await first.dispose();await second.dispose();}}

 async replacement():Promise<void>{const {CordisScope}=await import('../../src/composition.js');const scope=await CordisScope.start(this.descriptor(),this.authority()),old=scope.generation,lease=await scope.acquire(token);try{expect(lease.value.read()).toBe('default');const pending=await scope.beginReplacement(this.descriptor(true,{label:'next'}),old,1);expect(pending.state).toBe('pending');expect(ValuePlugin.live).toBe(1);await expect(scope.acquire(token)).rejects.toThrow('ADMISSION_CLOSED');await lease.release();const mounted=await scope.continueReplacement(100);expect(mounted.state).toBe('mounted');expect(ValuePlugin.live).toBe(1);const candidate=await scope.inspectCandidate(token);try{expect(candidate.value.read()).toBe('next');}finally{await candidate.release();}const generation=scope.commitReplacement();expect(generation).not.toBe(old);const current=await scope.acquire(token);try{expect(current.value.read()).toBe('next');}finally{await current.release();}}finally{await lease.release();await scope.dispose();}expect(ValuePlugin.live).toBe(0);}
}
class ScopeBoundaryTestsIntegration extends ScopeBoundaryTests {

 async transform():Promise<void>{const {CordisScope}=await import('../../src/composition.js');const scope=await CordisScope.start(this.descriptor(TransformPlugin),this.authority());try{const lease=await scope.acquire(token);try{expect(lease.value.read()).toBe('normalized:value');}finally{await lease.release();}}finally{await scope.dispose();}}

 async concurrent():Promise<void>{const {CordisScope}=await import('../../src/composition.js');const scope=await CordisScope.start(this.descriptor(),this.authority()),lease=await scope.acquire(token);try{const first=scope.beginReplacement(this.descriptor(),scope.generation,100);await expect(scope.continueReplacement(100)).rejects.toThrow('COMPOSITION_BUSY');await lease.release();await first;}finally{await lease.release();await scope.dispose();}}
}
class ScopeFailureTestsIntegration extends ScopeFailureTests {

 async rejected():Promise<void>{const {CordisScope}=await import('../../src/composition.js');const scope=await CordisScope.start(this.descriptor(),this.authority());try{await expect(scope.beginReplacement(this.descriptor(), 'f'.repeat(64),1)).rejects.toThrow('STALE_COMPOSITION');await expect(scope.beginReplacement(this.descriptor(),scope.generation,-1)).rejects.toThrow('INVALID_DRAIN_INTERVAL');const lease=await scope.acquire(token);try{expect(lease.value.read()).toBe('original');}finally{await lease.release();}}finally{await scope.dispose();}}

 async snapshot():Promise<void>{const {CordisScope}=await import('../../src/composition.js');const scope=await CordisScope.start(this.descriptor(),this.authority()),lease=await scope.acquire(token),configuration={label:'accepted'};try{expect((await scope.beginReplacement(this.descriptor(NextPlugin,configuration),scope.generation,1)).state).toBe('pending');configuration.label='mutated';await lease.release();await scope.continueReplacement(100);const candidate=await scope.inspectCandidate(token);try{expect(candidate.value.read()).toBe('accepted');expect(scope.commitReplacement.bind(scope)).toThrow('CANDIDATE_NOT_COMMITTABLE');}finally{await candidate.release();}scope.commitReplacement();}finally{await lease.release();await scope.dispose();}}

 async fence():Promise<void>{const {CordisScope}=await import('../../src/composition.js');const scope=await CordisScope.start(this.descriptor(),this.authority());try{await expect(scope.beginReplacement(this.descriptor(FailedValuePlugin),scope.generation,100)).rejects.toThrow('PROVIDER_LIFECYCLE');await expect(scope.acquire(token)).rejects.toThrow('ADMISSION_CLOSED');expect(ValuePlugin.live).toBe(0);}finally{await scope.dispose();}}
}
class ScopeShutdownTestsIntegration {

 async shutdown():Promise<void>{const {CordisScope}=await import('../../src/composition.js');DisposalGate.reset();const authority={scopeId:'fixture',target:'cli' as const,principalId:'fixture-owner',resourceScope:'fixture-owned'};const first={registrations:[{token,plugin:SlowDisposalPlugin,declaration:SlowDisposalPlugin.declaration,configuration:{},artifact:{kind:'bundled' as const,identity:'slow'}}],selections:[{scopeId:'fixture',capability:token.id,providerId:SlowDisposalPlugin.declaration.id}]};const next={registrations:[{token,plugin:NextPlugin,declaration:NextPlugin.declaration,configuration:{},artifact:{kind:'bundled' as const,identity:'next'}}],selections:[{scopeId:'fixture',capability:token.id,providerId:NextPlugin.declaration.id}]};const scope=await CordisScope.start(first,authority);try{const replacement=scope.beginReplacement(next,scope.generation,100);await DisposalGate.waitStarted;const disposed=scope.dispose();DisposalGate.release!();await disposed;await expect(replacement).rejects.toThrow('COMPOSITION_CLOSED');expect(ValuePlugin.live).toBe(0);await expect(scope.acquire(token)).rejects.toThrow('ADMISSION_CLOSED');}finally{DisposalGate.release!();await scope.dispose();}}
}
const suite=new ScopeTestsIntegration();
const boundaries=new ScopeBoundaryTestsIntegration();
const failures=new ScopeFailureTestsIntegration();
const shutdown=new ScopeShutdownTestsIntegration();
test("integration: normalized native defaults have one generation",suite.defaults.bind(suite));
test('integration: native replacement drains pinned leases disposes then mounts and awaits owner commit',suite.replacement.bind(suite));
test("integration: native Config transforms run once while generation uses normalized data",boundaries.transform.bind(boundaries));
test('integration: concurrent scope replacement cannot mount two native writers',boundaries.concurrent.bind(boundaries));
test('integration: stale and invalid replacement requests preserve native admission',failures.rejected.bind(failures));
test('integration: pending candidate captures caller configuration and waits for inspector release',failures.snapshot.bind(failures));
test('integration: failed native candidate fences admission and cleans constructed effects',failures.fence.bind(failures));
test('integration: shutdown during native disposal cannot mount a new candidate',shutdown.shutdown.bind(shutdown));
