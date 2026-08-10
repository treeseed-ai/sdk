const HOP_BY_HOP_HEADERS = new Set([
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
]);

const FORBIDDEN_INTERNAL_HEADERS = new Set([
	'x-treeseed-market-database-url',
	'x-treeseed-market-service-secret',
	'x-treeseed-internal-secret',
]);

export interface AdminPassthroughOptions {
	adminBaseUrl: string;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	maxRequestBytes?: number;
	maxResponseBytes?: number;
	serviceAssertion?: (request: Request) => Promise<string | null> | string | null;
	webSocketUpgrade?: (input: { request: Request; upstreamUrl: string; headers: Headers; signal: AbortSignal }) => Promise<Response> | Response;
}

class GatewayBodyLimitError extends RangeError {}

function connectionHeaders(headers: Headers) {
	return new Set((headers.get('connection') ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function sanitizedHeaders(source: Headers, forbidden: Set<string> = new Set()) {
	const connectionSpecific = connectionHeaders(source);
	const result = new Headers();
	for (const [name, value] of source) {
		const normalized = name.toLowerCase();
		if (HOP_BY_HOP_HEADERS.has(normalized) || connectionSpecific.has(normalized) || forbidden.has(normalized)) continue;
		if (normalized !== 'set-cookie') result.append(name, value);
	}
	const getSetCookie = (source as Headers & { getSetCookie?: () => string[] }).getSetCookie;
	for (const cookie of getSetCookie?.call(source) ?? []) result.append('set-cookie', cookie);
	return result;
}

function byteLimit(value: string | null, limit: number, label: string) {
	if (value && Number(value) > limit) throw new RangeError(`${label} exceeds the ${limit}-byte gateway limit.`);
}

function boundedBody(body: ReadableStream<Uint8Array> | null, limit: number, onClose: () => void) {
	if (!body) {
		onClose();
		return null;
	}
	const reader = body.getReader();
	let received = 0;
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const next = await reader.read();
				if (next.done) {
					onClose();
					controller.close();
					return;
				}
				received += next.value.byteLength;
				if (received > limit) throw new RangeError(`Upstream response exceeds the ${limit}-byte gateway limit.`);
				controller.enqueue(next.value);
			} catch (error) {
				onClose();
				controller.error(error);
			}
		},
		async cancel(reason) {
			onClose();
			await reader.cancel(reason);
		},
	});
}

function boundedRequestBody(body: ReadableStream<Uint8Array> | null, limit: number) {
	if (!body) return null;
	const reader = body.getReader();
	let received = 0;
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const next = await reader.read();
				if (next.done) {
					controller.close();
					return;
				}
				received += next.value.byteLength;
				if (received > limit) throw new GatewayBodyLimitError(`Request body exceeds the ${limit}-byte gateway limit.`);
				controller.enqueue(next.value);
			} catch (error) {
				controller.error(error);
			}
		},
		cancel: (reason) => reader.cancel(reason),
	});
}

export function isAdminPassthroughPath(pathname: string) {
	return pathname.startsWith('/v1/') && !pathname.startsWith('/v1/market/');
}

export function createAdminPassthroughHandler(options: AdminPassthroughOptions) {
	const adminBaseUrl = options.adminBaseUrl.replace(/\/+$/u, '');
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? 30_000;
	const maxRequestBytes = options.maxRequestBytes ?? 10 * 1024 * 1024;
	const maxResponseBytes = options.maxResponseBytes ?? 25 * 1024 * 1024;

	return async function passthrough(request: Request) {
		const incomingUrl = new URL(request.url);
		if (!isAdminPassthroughPath(incomingUrl.pathname)) {
			return Response.json({ error: 'market-route-not-proxyable' }, { status: 404 });
		}
		try {
			byteLimit(request.headers.get('content-length'), maxRequestBytes, 'Request body');
		} catch (error) {
			return Response.json({ error: 'request-too-large', message: error instanceof Error ? error.message : String(error) }, { status: 413 });
		}
		const headers = sanitizedHeaders(request.headers, FORBIDDEN_INTERNAL_HEADERS);
		headers.delete('host');
		const assertion = await options.serviceAssertion?.(request);
		if (assertion) headers.set('x-treeseed-service-assertion', assertion);
		const upstreamUrl = `${adminBaseUrl}${incomingUrl.pathname}${incomingUrl.search}`;
		const timeout = new AbortController();
		const timer = setTimeout(() => timeout.abort(new Error('Admin API gateway timeout.')), timeoutMs);
		const signal = AbortSignal.any([request.signal, timeout.signal]);
		try {
			if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
				if (!options.webSocketUpgrade) {
					clearTimeout(timer);
					return Response.json({ error: 'websocket-upgrade-unavailable' }, { status: 501 });
				}
				const response = await options.webSocketUpgrade({ request, upstreamUrl, headers, signal });
				clearTimeout(timer);
				return response;
			}
			const upstream = await fetchImpl(upstreamUrl, {
				method: request.method,
				headers,
				body: request.method === 'GET' || request.method === 'HEAD' ? undefined : boundedRequestBody(request.body, maxRequestBytes),
				redirect: 'manual',
				signal,
				duplex: request.body ? 'half' : undefined,
			} as RequestInit & { duplex?: 'half' });
			if (upstream.status === 101) {
				clearTimeout(timer);
				return upstream;
			}
			byteLimit(upstream.headers.get('content-length'), maxResponseBytes, 'Upstream response');
			return new Response(boundedBody(upstream.body, maxResponseBytes, () => clearTimeout(timer)), {
				status: upstream.status,
				statusText: upstream.statusText,
				headers: sanitizedHeaders(upstream.headers, FORBIDDEN_INTERNAL_HEADERS),
			});
		} catch (error) {
			clearTimeout(timer);
			if (error instanceof GatewayBodyLimitError) return Response.json({ error: 'request-too-large', message: error.message }, { status: 413 });
			if (error instanceof RangeError) return Response.json({ error: 'upstream-response-too-large', message: error.message }, { status: 502 });
			if (signal.aborted) return Response.json({ error: 'admin-upstream-timeout', message: 'Hosted Admin API did not complete before the gateway timeout.' }, { status: 504 });
			return Response.json({ error: 'admin-upstream-unavailable', message: error instanceof Error ? error.message : String(error) }, { status: 502 });
		}
	};
}
