import { test, expect } from 'bun:test';
import { z } from 'zod';
import { spawnSync } from 'node:child_process';
import { CapabilityToken, ProviderSchemas, type ProviderDeclaration } from '../../src/contracts.js';
import { SourcePolicy } from '../../src/source-policy.js';
import { Context, CordisComposition, CordisServiceLocator, CompositionError, type ProviderRegistration, type TrustedCompositionContext } from '../../src/runtime.js';
import {Probe,ProbeValidation,token,ProbeProvider,IdentityConfiguration,SharedConfigurationProvider,OtherProvider,BadCleanupProvider,ThrowingProvider,MissingDependency,CycleFirst,CycleSecond,DependentProvider,Receiver,Consumer,Uninjected,RuntimeTests} from '../support/runtime-test-support.js';
class RuntimeTestsAcceptance extends RuntimeTests {

  async packageProgram():Promise<void> {
    const code="import {CordisComposition,Context} from './dist/src/runtime.js'; class Probe {static async run(){const h=await CordisComposition.start({registrations:[],selections:[]},{scopeId:'node',target:'cli',principalId:'owner',resourceScope:'fixture'});if(!Context.is(h.context))throw new Error('no native root');await h.dispose();}} await Probe.run();";
    const result=spawnSync('node',['--input-type=module','-e',code],{encoding:'utf8'});expect(result.status).toBe(0);expect(result.stderr).toBe('');
  }
}
const suite=new RuntimeTestsAcceptance();
test("acceptance: explicit runtime package executes native Cordis under Node",suite.packageProgram.bind(suite));
