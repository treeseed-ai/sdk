export type GatewayDependency = 'market-database' | 'admin-api' | 'internal-auth' | 'provider-bindings';

export interface GatewayHealthOptions {
	checks: Record<GatewayDependency, () => Promise<boolean>>;
}

async function observeDependency(name: GatewayDependency, check: () => Promise<boolean>) {
	try {
		return { name, ok: await check() };
	} catch (error) {
		return { name, ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

export function createGatewayHealthHandlers(options: GatewayHealthOptions) {
	return {
		process() {
			return Response.json({ ok: true, service: 'market-gateway' });
		},
		async deep() {
			const dependencies = await Promise.all((Object.entries(options.checks) as Array<[GatewayDependency, () => Promise<boolean>]>).map(([name, check]) => observeDependency(name, check)));
			const ok = dependencies.every((dependency) => dependency.ok);
			return Response.json({ ok, dependencies }, { status: ok ? 200 : 503 });
		},
		async ready() {
			const admin = await observeDependency('admin-api', options.checks['admin-api']);
			return Response.json({ ok: admin.ok, dependency: admin }, { status: admin.ok ? 200 : 503 });
		},
	};
}
