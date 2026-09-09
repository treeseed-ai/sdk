import type { CommandNodeDescriptor } from '../../command-tree.ts';

export function identityLoginCommand(value: CommandNodeDescriptor): CommandNodeDescriptor {
	if (value.nodeType !== 'leaf') throw new Error('Authentication login must be a leaf command.');
	return {...value, options:[
		...(value.options ?? []),
		{name:'--timeout', description:'Maximum seconds to wait for identity authorization.', type:'number'},
		{name:'--device', description:'Use headless device authorization instead of local browser PKCE.', type:'boolean'},
		{name:'--issuer', description:'Choose an authorization server advertised by the selected API.', type:'string'},
	]};
}
