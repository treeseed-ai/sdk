import {expect,it} from 'vitest';
import * as product from '../../../acceptance/golden-product.ts';

it('resolves canonical exact SDK source citation locations without accepting moving foreign malformed or traversal authority',()=>{
 const parse=Reflect.get(product,'parseSdkResearchCitation') as ((value:unknown,base:string)=>unknown)|undefined;
 expect(parse,'actual source citations require independently resolved frozen authority').toBeTypeOf('function');if(!parse)return;
 const base='a'.repeat(40),path='src/operator-contracts/workday-lifecycle.ts',url='https://github.com/treeseed-ai/sdk/blob/'+base+'/'+path+'#L54-L80',reference={store:'git',model:'repository',id:'sdk',repository:'treeseed-ai/sdk',commit:base,path,anchor:'L54-L80'},expected={repository:'treeseed-ai/sdk',commit:base,path,anchor:'L54-L80'};
 const held=structuredClone(reference);expect(parse(url,base)).toEqual(expected);expect(parse(reference,base)).toEqual(expected);expect(reference).toEqual(held);
 expect(parse(url.split('#')[0],base)).toEqual({repository:'treeseed-ai/sdk',commit:base,path});
 for(const value of [undefined,null,false,0,[],{},'', ' '+url,url+' ',url.replace('https:','http:'),url.replace('github.com','foreign.test'),url.replace('/sdk/','/api/'),url.replace(base,'staging'),url.replace(base,'b'.repeat(40)),url+'?foreign=true',url.replace('blob/','tree/'),url.replace(path,'src/../'+path),url.replace(path,'../'+path),url.replace(path,'src/secret.txt'),url.replace('#L54-L80','#L0'),url.replace('#L54-L80','#L80-L54'),url.replace('#L54-L80','#L1-L9007199254740992'),url.replace('#L54-L80','#unresolved'),{...reference,store:'treedx'},{...reference,repository:'treeseed-ai/api'},{...reference,commit:'staging'},{...reference,commit:'b'.repeat(40)},{...reference,path:'../'+path},{...reference,path:'/tmp/source.ts'},{...reference,path:'src/../source.ts'},{...reference,path:'src/source\u0000.ts'},{...reference,anchor:'L0'}, {...reference,anchor:'L80-L54'}]){
  const before=structuredClone(value);expect(()=>parse(value,base),JSON.stringify(value)).toThrow('ACCEPTANCE_SDK_RESEARCH_CITATION');expect(value).toEqual(before);
 }
 for(const invalid of ['', 'staging','a'.repeat(39),'a'.repeat(41),'A'.repeat(40)])expect(()=>parse(url,invalid)).toThrow('ACCEPTANCE_SDK_RESEARCH_CITATION');
 expect(parse({...reference,anchor:'WorkdayIntent'},base)).toEqual({...expected,anchor:'WorkdayIntent'});
});
