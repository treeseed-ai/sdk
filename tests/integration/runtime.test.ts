import { test, expect } from 'bun:test';
import { z } from 'zod';
import { spawnSync } from 'node:child_process';
import { CapabilityToken, ProviderSchemas, type ProviderDeclaration } from '../../src/contracts.js';
import { SourcePolicy } from '../../src/source-policy.js';
import { Context, CordisComposition, CordisServiceLocator, CompositionError, type ProviderRegistration, type TrustedCompositionContext } from '../../src/runtime.js';
import {Probe,ProbeValidation,token,ProbeProvider,IdentityConfiguration,SharedConfigurationProvider,OtherProvider,BadCleanupProvider,ThrowingProvider,MissingDependency,CycleFirst,CycleSecond,DependentProvider,Receiver,Consumer,Uninjected,RuntimeTests} from '../support/runtime-test-support.js';
class RuntimeTestsIntegration extends RuntimeTests {

  async native():Promise<void> {
    for(const second of [false,true]) {
      const handle=await CordisComposition.start(this.descriptor(second),this.authority()),receiver=new Receiver();
      try {
        await handle.mount(Consumer,receiver);const locator=CordisServiceLocator.from(receiver.context!),lease=await locator.acquire(token);
        expect(Context.is(receiver.context)).toBe(true);expect(handle.context.registry.size).toBeGreaterThan(0);
        expect(lease.value.read()).toBe(second?'second':'first');expect(lease.generation).toBe(handle.generation);
        expect(locator.describe(token).filter(RuntimeTests.selected).length).toBe(1);
        const cached=lease.value.read;await lease.release();expect(RuntimeTests.call.bind(null,cached)).toThrow('LEASE_CLOSED');
      }finally{await handle.dispose();}
      expect(ProbeProvider.active).toBe(0);
    }
  }

  async configurationIsolation():Promise<void> {
    const configuration={label:'accepted'},registration:ProviderRegistration={...this.registration(),plugin:SharedConfigurationProvider,configuration};
    const handle=await CordisComposition.start({registrations:[registration],selections:[{scopeId:'scope',capability:'probe',providerId:'first'}]},this.authority()),receiver=new Receiver();
    try{configuration.label='changed';await handle.mount(Consumer,receiver);const lease=await handle.locator(receiver.context!).acquire(token);expect(lease.value.read()).toBe('accepted');await lease.release();}finally{await handle.dispose();}
  }

  async isolation():Promise<void> {
    const first=await CordisComposition.start(this.descriptor(),this.authority());
    const second=await CordisComposition.start(this.descriptor(true),this.authority());
    const receiver=new Receiver(),uninjected=new Receiver();
    try {
      await first.mount(Consumer,receiver);await first.mount(Uninjected,uninjected);
      expect(second.locator.bind(second,receiver.context!)).toThrow('SCOPE_MISMATCH');
      expect(first.locator.bind(first,first.context)).toThrow('DECLARED_INJECTION_REQUIRED');
      const locator=first.locator(uninjected.context!);await expect(locator.acquire(token)).rejects.toThrow('DECLARED_INJECTION_REQUIRED');
      const lease=await first.locator(receiver.context!).acquire(token),cached=lease.value.read;await first.dispose();expect(RuntimeTests.call.bind(null,cached)).toThrow();
    }finally{await first.dispose();await second.dispose();}
  }

  async blocked():Promise<void> {
    const authority=this.authority();
    const empty=await CordisComposition.start({registrations:[],selections:[]},authority);await empty.dispose();
    const duplicate=this.descriptor();duplicate.registrations.push(this.registration());await expect(CordisComposition.start(duplicate,authority)).rejects.toThrow('DUPLICATE_PROVIDER');
    const absent=this.descriptor();absent.selections[0]!.providerId='absent';await expect(CordisComposition.start(absent,authority)).rejects.toThrow('MISSING_PROVIDER');
    const wrongScope=this.descriptor();wrongScope.selections[0]!.scopeId='other';await expect(CordisComposition.start(wrongScope,authority)).rejects.toThrow('SCOPE_MISMATCH');
    const config=this.descriptor();config.registrations[0]!.configuration={label:7};await expect(CordisComposition.start(config,authority)).rejects.toThrow('INVALID_PROVIDER_CONFIGURATION');
    const incompatible=this.descriptor();incompatible.registrations[0]!.declaration={...ProbeProvider.declaration,contractVersion:'unsupported'};await expect(CordisComposition.start(incompatible,authority)).rejects.toThrow('INVALID_PROVIDER_DECLARATION');
    const drift=this.descriptor();drift.registrations[0]!.declaration={...ProbeProvider.declaration,inject:['missing']};await expect(CordisComposition.start(drift,authority)).rejects.toThrow('DECLARATION_DRIFT');
  }

  async dependencyOrder():Promise<void> {
    const dependent=new CapabilityToken<Probe>('aa-dependent','0.3.0-cordis.1',new ProbeValidation());
    const registration:ProviderRegistration={token:dependent,declaration:DependentProvider.declaration,plugin:DependentProvider,configuration:{label:'dependent'},artifact:{kind:'bundled',identity:'dependent'}};
    const handle=await CordisComposition.start({registrations:[registration,this.registration()],selections:[{scopeId:'scope',capability:'aa-dependent',providerId:'dependent'},{scopeId:'scope',capability:'probe',providerId:'first'}]},this.authority());
    try{expect(handle.describe(dependent).filter(RuntimeTests.selected)[0]?.ready).toBe(true);}finally{await handle.dispose();}
  }

  async additionalBlockers():Promise<void> {
    const dependency={...this.registration(),plugin:MissingDependency,declaration:MissingDependency.declaration};
    await expect(CordisComposition.start({registrations:[dependency],selections:[{scopeId:'scope',capability:'probe',providerId:'first'}]},this.authority())).rejects.toThrow('MISSING_DEPENDENCY');
    const cycle={token:new CapabilityToken<Probe>('cycle','0.3.0-cordis.1',new ProbeValidation()),plugin:CycleSecond,declaration:CycleSecond.declaration,configuration:{label:'cycle'},artifact:{kind:'bundled' as const,identity:'cycle'}};
    await expect(CordisComposition.start({registrations:[{...this.registration(),plugin:CycleFirst,declaration:CycleFirst.declaration},cycle],selections:[{scopeId:'scope',capability:'probe',providerId:'first'},{scopeId:'scope',capability:'cycle',providerId:'cycle'}]},this.authority())).rejects.toThrow('DEPENDENCY_CYCLE');
    await expect(CordisComposition.start({registrations:[this.registration(false,ThrowingProvider)],selections:[{scopeId:'scope',capability:'probe',providerId:'first'}]},this.authority())).rejects.toThrow('PROVIDER_LIFECYCLE');expect(ProbeProvider.active).toBe(0);
    const first=await CordisComposition.start(this.descriptor(),this.authority()),reversed=this.descriptor();reversed.registrations.reverse();const second=await CordisComposition.start(reversed,this.authority());try{expect(first.generation).toBe(second.generation);}finally{await first.dispose();await second.dispose();}
    const policy=new SourcePolicy();expect(policy.inspect('src/main.ts',"import {ComposeDeploymentHost as Concrete} from '@treeseed-cordis/deployment';class Consumer{readonly host=new Concrete();}").length).toBeGreaterThan(0);expect(policy.inspect('src/runtime.ts','class InstalledProviderLoader {async importVerified(path:string){return import(path);}}').length).toBeGreaterThan(0);expect(policy.inspect('src/other.ts','class InstalledProviderLoader {async importVerified(verified:{url:string}){return import(verified.url);}}').length).toBeGreaterThan(0);
  }

  async cleanupFailure():Promise<void> {
    const handle=await CordisComposition.start({registrations:[this.registration(false,BadCleanupProvider)],selections:[{scopeId:'scope',capability:'probe',providerId:'first'}]},this.authority());
    try{await handle.dispose();throw new Error('cleanup should fail');}catch(error){expect(error).toBeInstanceOf(CompositionError);expect(String(error)).toContain('PROVIDER_LIFECYCLE');expect(String(error)).not.toContain('secret-cleanup-canary');}
  }
}
const suite=new RuntimeTestsIntegration();
test('integration: native selected providers share one contract and dispose',suite.native.bind(suite));
test('integration: scope declared injection and released leases are enforced',suite.isolation.bind(suite));
test("integration: composition rejects missing duplicate incompatible and drifted providers",suite.blocked.bind(suite));
test('integration: native cleanup errors cannot become successful completion',suite.cleanupFailure.bind(suite));
test("integration: native missing dependencies cycles constructor failures and narrow source policy",suite.additionalBlockers.bind(suite));
test('integration: native dependency loading settles before readiness in reverse registration order',suite.dependencyOrder.bind(suite));
test('integration: caller configuration mutation cannot change an accepted provider generation',suite.configurationIsolation.bind(suite));
