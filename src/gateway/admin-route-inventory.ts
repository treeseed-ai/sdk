export interface AdminGatewayRoute {
	method: string;
	path: string;
}

function escapePattern(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function compilePath(path: string) {
	if (!path.startsWith('/v1/')) throw new Error(`Admin gateway route ${path} is outside /v1/.`);
	if (path.startsWith('/v1/market/')) throw new Error(`Admin gateway route ${path} shadows the private Market namespace.`);
	const segments = path.split('/').map((segment) => segment.startsWith(':')
		? segment.length > 1 ? '[^/]+' : (() => { throw new Error(`Admin gateway route ${path} has an empty parameter.`); })()
		: escapePattern(segment));
	return new RegExp(`^${segments.join('/')}$`, 'u');
}

export function createAdminRouteMatcher(routes: readonly AdminGatewayRoute[]) {
	const seen = new Set<string>();
	const compiled = routes.map((route) => {
		const method = route.method.trim().toUpperCase();
		if (!/^[A-Z]+$/u.test(method)) throw new Error(`Admin gateway route ${route.path} has invalid method ${route.method}.`);
		const key = `${method} ${route.path}`;
		if (seen.has(key)) throw new Error(`Admin gateway descriptor contains duplicate route ${key}.`);
		seen.add(key);
		return { method, path: compilePath(route.path) };
	});
	if (compiled.length === 0) throw new Error('Admin gateway descriptor must contain at least one route.');
	return (method: string, pathname: string) => compiled.some((route) => route.method === method.toUpperCase() && route.path.test(pathname));
}
