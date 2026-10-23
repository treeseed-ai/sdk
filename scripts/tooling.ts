import { ProjectTooling } from '../src/source-policy.js';
import { ContractProjection } from '../src/contracts.js';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
class SdkTooling {
  static run():void {
    ProjectTooling.run();
    const json=JSON.stringify(ContractProjection.generate(),null,2)+'\n';
    if(process.argv[2]==='build') {mkdirSync('dist',{recursive:true});writeFileSync('dist/contract.json',json);}
    else if(existsSync('dist/contract.json')&&readFileSync('dist/contract.json','utf8')!==json) throw new Error('Generated contract drift');
  }
}
SdkTooling.run();
