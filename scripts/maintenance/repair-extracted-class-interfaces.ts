import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

interface ExtractedClass {
	entry: string;
	className: string;
}

const genericMethodSignatures: Record<string, string> = {
	'AgentSdk.envelope': "envelope<TPayload>(model: string, operation: import('../sdk-types.ts').SdkJsonEnvelope<TPayload>['operation'], payload: TPayload, meta?: Record<string, unknown>): import('../sdk-types.ts').SdkJsonEnvelope<TPayload>;",
	'MarketClient.request': "request<T>(path: string, options?: { method?: string; body?: unknown; requireAuth?: boolean; headers?: Record<string, string> }): Promise<T>;",
	'MarketClient.requestFirst': "requestFirst<T>(paths: string[], options?: { method?: string; body?: unknown; requireAuth?: boolean; headers?: Record<string, string> }): Promise<T>;",
};

const extractedClasses: ExtractedClass[] = [
	{ entry: 'src/sdk.ts', className: 'AgentSdk' },
	{ entry: 'src/market-client.ts', className: 'MarketClient' },
];

for (const { entry, className } of extractedClasses) {
	const entryPath = resolve(entry);
	const stem = basename(entryPath, '.ts');
	const directory = resolve(dirname(entryPath), stem);
	const methodsSource = readFileSync(resolve(directory, 'methods.ts'), 'utf8');
	const methods = [...methodsSource.matchAll(/import \{ (\w+Method) \} from '\.\/(.+\.ts)';/gu)]
		.map((match) => ({ functionName: match[1]!, file: match[2]! }));
	if (methods.length === 0) throw new Error(`${entry}: no extracted methods found`);

	const properties = methods.map(({ functionName, file }) => {
		const methodName = functionName.replace(/Method$/u, '');
		const genericSignature = genericMethodSignatures[`${className}.${methodName}`];
		return `\t\t${genericSignature ?? `${methodName}: OmitThisParameter<typeof import('./${file}').${functionName}>;`}`;
	}).join('\n');
	const modulePath = `../${basename(entryPath)}`;
	writeFileSync(resolve(directory, 'interface.ts'), `declare module '${modulePath}' {
\tinterface ${className} {
${properties}
\t}
}

export {};
`);
	console.log(`${entry}: restored inferred types for ${methods.length} extracted methods`);
}
