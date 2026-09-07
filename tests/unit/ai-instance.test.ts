import {expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {aiInstanceDraftSchema} from '../../src/deployment/ai-instance';
const draft={name:'Team AI',projectId:'project',purpose:'inference',hostingConnectionId:'host',storageConnectionId:null,model:'model',schedule:'always',timeZone:'UTC'};
it('accepts a credential-free draft and rejects embedded credential properties',()=>{expect(aiInstanceDraftSchema.safeParse(draft).success).toBe(true);expect(aiInstanceDraftSchema.safeParse({...draft,apiToken:'never-store-here'}).success).toBe(false);});
it('requires storage for training and validates time zones',()=>{expect(aiInstanceDraftSchema.safeParse({...draft,purpose:'training'}).success).toBe(false);expect(aiInstanceDraftSchema.safeParse({...draft,timeZone:'not/a-zone'}).success).toBe(false);});
it('loads the built catalog in plain Node without a TypeScript resolver',()=>{
 expect(()=>execFileSync(process.execPath,['--input-type=module','-e',"const sdk=await import('./dist/operator-contracts/index.js');if(!sdk.CONTROL_PLANE_OPERATIONS.aiInstances)throw Error('Missing AI catalog');"],{cwd:process.cwd(),stdio:'pipe'})).not.toThrow();
});
