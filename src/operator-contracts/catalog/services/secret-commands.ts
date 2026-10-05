import type { CommandNodeDescriptor } from '../../command-tree.ts';
export const managedSecretCommands: CommandNodeDescriptor = {
  nodeType:'branch',segment:'services',description:'Team service credentials.',children:[{
    nodeType:'branch',segment:'credentials',description:'Manage credentials in core OpenBao.',
    children:(['show','put','delete','validate'] as const).map(name=>({
      nodeType:'leaf' as const,segment:name,description:`${name} an exact service credential profile.`,kind:name==='show'?'read' as const:'mutation' as const,
      arguments:[{name:'connection',description:'Service connection ID.',required:true},{name:'profile',description:'Credential profile ID.',required:true}],
      options:[{name:'--team' as const,description:'Authorized team ID.',type:'string' as const},
        ...(name==='show'?[]:[{name:'--plan' as const,description:'Inspect the proposed operation without mutation or secret input.',type:'boolean' as const},
          {name:'--expected-version' as const,description:'Exact current credential version; zero for first creation.',type:'number' as const,required:true}]),
        ...(name==='put'?[{name:'--stdin' as const,description:'Read the credential field object as JSON from standard input.',type:'boolean' as const}]:[])],
      authorization:{capability:name==='show'?'secrets.read':'secrets.write',confirmation:'never' as const},
      resultSchemaId:`treeseed.services.credentials.${name}/v1`,
      execution:{kind:'local' as const,handlerId:`local.services.credentials.${name}` as const},
    })),
  }],
};
