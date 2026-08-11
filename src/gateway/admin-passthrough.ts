import { createAdminRouteMatcher, type AdminGatewayRoute } from './admin-route-inventory.ts';
import { FORBIDDEN_INTERNAL_HEADERS, sanitizedGatewayHeaders } from './header-policy.ts';

export interface AdminPassthroughOptions {
	adminBaseUrl: string;
	adminRoutes: readonly AdminGatewayRoute[];
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	maxRequestBytes?: number;
	maxResponseBytes?: number;
	serviceAssertion?: (request: Request) => Promise<string | null> | string | null;
	webSocketUpgrade?: (input: { request: Request; upstreamUrl: string; headers: Headers; signal: AbortSignal }) => Promise<Response> | Response;
}

class GatewayBodyLimitError extends RangeError {}

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

export function createAdminPassthroughHandler(options: AdminPassthroughOptions) {
	const adminBaseUrl = options.adminBaseUrl.replace(/\/+$/u, '');
	const matchesAdminRoute = createAdminRouteMatcher(options.adminRoutes);
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? 30_000;
	const maxRequestBytes = options.maxRequestBytes ?? 10 * 1024 * 1024;
	const maxResponseBytes = options.maxResponseBytes ?? 25 * 1024 * 1024;

	return async function passthrough(request: Request) {
		const incomingUrl = new URL(request.url);
		if (!matchesAdminRoute(request.method, incomingUrl.pathname)) {
			return Response.json({ error: 'admin-route-not-declared' }, { status: 404 });
		}
		try {
			byteLimit(request.headers.get('content-length'), maxRequestBytes, 'Request body');
		} catch (error) {
			return Response.json({ error: 'request-too-large', message: error instanceof Error ? error.message : String(error) }, { status: 413 });
		}
		if (request.signal.aborted) return Response.json({ error: 'client-cancelled', message: 'The client cancelled the Admin API request.' }, { status: 499 });
		const headers = sanitizedGatewayHeaders(request.headers, FORBIDDEN_INTERNAL_HEADERS);
		headers.delete('host');
		let assertion: string | null | undefined;
		try {
			assertion = await options.serviceAssertion?.(request);
		} catch (error) {
			return Response.json({ error: 'admin-service-assertion-failed', message: error instanceof Error ? error.message : String(error) }, { status: 502 });
		}
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
				headers: sanitizedGatewayHeaders(upstream.headers, FORBIDDEN_INTERNAL_HEADERS),
			});
		} catch (error) {
			clearTimeout(timer);
			if (error instanceof GatewayBodyLimitError) return Response.json({ error: 'request-too-large', message: error.message }, { status: 413 });
			if (error instanceof RangeError) return Response.json({ error: 'upstream-response-too-large', message: error.message }, { status: 502 });
			if (request.signal.aborted) return Response.json({ error: 'client-cancelled', message: 'The client cancelled the Admin API request.' }, { status: 499 });
			if (timeout.signal.aborted) return Response.json({ error: 'admin-upstream-timeout', message: 'Hosted Admin API did not complete before the gateway timeout.' }, { status: 504 });
			return Response.json({ error: 'admin-upstream-unavailable', message: error instanceof Error ? error.message : String(error) }, { status: 502 });
		}
	};
}
