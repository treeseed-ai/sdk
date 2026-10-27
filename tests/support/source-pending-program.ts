import {PluginManagementSchemas,PlatformOperations} from '@treeseed-cordis/sdk/portable';
class SourcePendingProgram {
    static run():void{
        const source={requestId:'durable-source-request',pluginId:null,artifact:null,target:'deployment',planId:null,applicationId:null,previousGeneration:null,activeGeneration:null,state:'pending',blockers:[],nextActions:['inspect-request'],acknowledgements:[]};
        PluginManagementSchemas.result.parse(source);
        const envelope={command:'plugin.install',success:false,result:source,problem:{code:'PLUGIN_PENDING',title:'Pending',detail:'Source acquisition continues under the accepted request.'},blockers:[],references:['durable-source-request']};
        PluginManagementSchemas.envelope.parse(envelope);
        if(PluginManagementSchemas.envelope.safeParse({...envelope,success:true,problem:null}).success)throw new Error('Pending reported activation success');
        const acquired={...source,pluginId:'fixture',artifact:{package:'@fixture/plugin',version:'1.0.0',integrity:'a'.repeat(64)}};
        PluginManagementSchemas.result.parse(acquired);
        PluginManagementSchemas.result.parse({...acquired,planId:'plan-real',applicationId:'app-real'});
        for(const change of [{planId:'plan-invented'},{applicationId:'app-invented'},{activeGeneration:'b'.repeat(64)},{acknowledgements:[{target:'deployment',scopeId:'fixture',generation:'b'.repeat(64),ready:true}]},{state:'active'},{state:'already-active'}])if(PluginManagementSchemas.result.safeParse({...acquired,...change}).success)throw new Error('Unobserved source acquisition claims accepted application or activation');
        if(PlatformOperations.all.length!==7)throw new Error('Operation identifiers changed');
        process.stdout.write('source-pending-ok\n');
    }
}
SourcePendingProgram.run();
