import {spawnSync} from 'node:child_process';
import {test,expect} from 'bun:test';
import {z} from 'zod';
import {Context,CordisComposition,type ProviderRegistration} from '../../src/composition.js';
import {CapabilityToken,ProviderV4Schemas} from '../../src/schemas.js';
import {Value,ValueValidation,token,ValuePlugin,NextPlugin,ScopeTests,TransformValues,TransformPlugin,ScopeBoundaryTests,FailedValuePlugin,ScopeFailureTests,DisposalGate,SlowDisposalPlugin,ConfigurationFault,InvalidConfigurationPlugin} from '../support/scope-test-support.js';
class ScopeProgramTestsAcceptance {

 program():void{const result=spawnSync('node',['dist/tests/support/scope-program.js'],{encoding:'utf8',timeout:10000});expect(result.status).toBe(0);expect(result.stderr).toBe('');expect(result.stdout).toBe('scope-listener-ok\n');}
}
const scopeProgram=new ScopeProgramTestsAcceptance();
test("acceptance: built native scope replaces a real listener on the same port and cleans it up",scopeProgram.program.bind(scopeProgram));
