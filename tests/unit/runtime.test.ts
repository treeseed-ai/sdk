import { test, expect } from 'bun:test';
import { z } from 'zod';
import { spawnSync } from 'node:child_process';
import { CapabilityToken, ProviderSchemas, type ProviderDeclaration } from '../../src/contracts.js';
import { SourcePolicy } from '../../src/source-policy.js';
import { Context, CordisComposition, CordisServiceLocator, CompositionError, type ProviderRegistration, type TrustedCompositionContext } from '../../src/runtime.js';
import {Probe,ProbeValidation,token,ProbeProvider,IdentityConfiguration,SharedConfigurationProvider,OtherProvider,BadCleanupProvider,ThrowingProvider,MissingDependency,CycleFirst,CycleSecond,DependentProvider,Receiver,Consumer,Uninjected,RuntimeTests} from '../support/runtime-test-support.js';
class RuntimeTestsUnit extends RuntimeTests {

  metadata():void {expect(ProviderSchemas.selection.safeParse({scopeId:'s',capability:'probe',providerId:'p',principalId:'forged'}).success).toBe(false);expect(ProviderSchemas.declaration.safeParse({...ProbeProvider.declaration,contractVersion:'0.2.0-cordis.1'}).success).toBe(false);}
}
const suite=new RuntimeTestsUnit();
test('unit: provider metadata and strict authority boundary',suite.metadata.bind(suite));
