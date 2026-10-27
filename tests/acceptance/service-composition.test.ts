import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {ServiceCompositionTests} from '../support/service-composition-test-support.js';
class ServiceCompositionTestsAcceptance extends ServiceCompositionTests {

  portableProgram():void {
    const code="import {CordisComposition} from '@treeseed-cordis/sdk/composition';class Program{static async run(){const h=await CordisComposition.start({registrations:[],selections:[]},{scopeId:'browser',target:'browser',principalId:'fixture',resourceScope:'public'});if(!/^[a-f0-9]{64}$/.test(h.generation))throw new Error('generation');await h.dispose();}}await Program.run();";
    const result=spawnSync('node',['--input-type=module','-e',code],{encoding:'utf8'});expect(result.status).toBe(0);expect(result.stderr).toBe('');
  }
}
const suite=new ServiceCompositionTestsAcceptance();
test("acceptance: Portable service composition is a real public Node/browser program",suite.portableProgram.bind(suite));
