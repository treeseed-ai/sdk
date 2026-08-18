import { request as requestHttp, type IncomingMessage } from 'node:http';
import { request as requestHttps } from 'node:https';
import type { Duplex } from 'node:stream';
import { createAdminRouteMatcher, type AdminGatewayRoute } from './admin-route-inventory.ts';
import { FORBIDDEN_INTERNAL_HEADERS, isForbiddenGatewayHeader, sanitizedGatewayHeaders } from './header-policy.ts';

export interface NodeWebSocketProxyOptions {
	adminBaseUrl: string;
	adminRoutes: readonly AdminGatewayRoute[];
	incoming: IncomingMessage;
	socket: Duplex;
	head: Buffer;
	timeoutMs?: number;
	serviceAssertion?: (request: Request) => Promise<string | null> | string | null;
}

function incomingHeaders(message: IncomingMessage) {
	const headers = new Headers();
	for (let index = 0; index < message.rawHeaders.length; index += 2) {
		const name = message.rawHeaders[index];
		const value = message.rawHeaders[index + 1];
		if (name && value !== undefined) headers.append(name, value);
	}
	return headers;
}

function safeRawHeaders(rawHeaders: string[], upgrade: boolean) {
	const headers: string[] = [];
	for (let index = 0; index < rawHeaders.length; index += 2) {
		const name = rawHeaders[index];
		const value = rawHeaders[index + 1];
		if (!name || value === undefined || /[\r\n]/u.test(value)) continue;
		const normalized = name.toLowerCase();
		if (isForbiddenGatewayHeader(normalized) || ['connection', 'upgrade', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding'].includes(normalized)) continue;
		headers.push(`${name}: ${value}`);
	}
	if (upgrade) headers.push('Connection: Upgrade', 'Upgrade: websocket');
	return headers;
}

function writeResponse(socket: Duplex, status: number, statusText: string, headers: string[]) {
	if (socket.destroyed) return;
	socket.write(`HTTP/1.1 ${status} ${statusText}\r\n${headers.join('\r\n')}\r\n\r\n`);
}

function writeError(socket: Duplex, status: number, error: string, message: string) {
	const body = JSON.stringify({ error, message });
	writeResponse(socket, status, status === 404 ? 'Not Found' : status === 504 ? 'Gateway Timeout' : 'Bad Gateway', [
		'Content-Type: application/json',
		`Content-Length: ${Buffer.byteLength(body)}`,
		'Connection: close',
	]);
	if (!socket.destroyed) socket.end(body);
}

export async function proxyNodeWebSocketUpgrade(options: NodeWebSocketProxyOptions) {
	const path = options.incoming.url ?? '/';
	const incomingUrl = new URL(path, 'http://gateway.internal');
	const matches = createAdminRouteMatcher(options.adminRoutes);
	if (options.incoming.method !== 'GET' || !matches('GET', incomingUrl.pathname)) {
		writeError(options.socket, 404, 'admin-route-not-declared', 'The WebSocket route is not declared by the hosted Admin API.');
		return 'rejected' as const;
	}
	const headers = sanitizedGatewayHeaders(incomingHeaders(options.incoming), FORBIDDEN_INTERNAL_HEADERS);
	headers.delete('host');
	headers.set('connection', 'Upgrade');
	headers.set('upgrade', 'websocket');
	const request = new Request(`http://gateway.internal${incomingUrl.pathname}${incomingUrl.search}`, { headers });
	try {
		const assertion = await options.serviceAssertion?.(request);
		if (assertion) headers.set('x-treeseed-service-assertion', assertion);
	} catch (error) {
		writeError(options.socket, 502, 'admin-service-assertion-failed', error instanceof Error ? error.message : String(error));
		return 'rejected' as const;
	}
	const upstreamUrl = new URL(`${options.adminBaseUrl.replace(/\/+$/u, '')}${incomingUrl.pathname}${incomingUrl.search}`);
	if (upstreamUrl.protocol !== 'http:' && upstreamUrl.protocol !== 'https:') {
		writeError(options.socket, 502, 'admin-upstream-invalid', 'Hosted Admin API WebSocket URL must use HTTP or HTTPS.');
		return 'rejected' as const;
	}
	return await new Promise<'upgraded' | 'rejected'>((resolve) => {
		let settled = false;
		const finish = (result: 'upgraded' | 'rejected') => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
		};
		const requester = upstreamUrl.protocol === 'https:' ? requestHttps : requestHttp;
		const upstreamRequest = requester(upstreamUrl, { method: 'GET', headers: Object.fromEntries(headers) });
		const timer = setTimeout(() => {
			upstreamRequest.destroy(new Error('Admin API WebSocket gateway timeout.'));
			writeError(options.socket, 504, 'admin-upstream-timeout', 'Hosted Admin API did not complete the WebSocket upgrade before the gateway timeout.');
			finish('rejected');
		}, options.timeoutMs ?? 30_000);
		options.socket.once('close', () => {
			if (!settled) upstreamRequest.destroy(new Error('Gateway client cancelled the WebSocket upgrade.'));
			finish('rejected');
		});
		upstreamRequest.once('upgrade', (response, upstreamSocket, upstreamHead) => {
			writeResponse(options.socket, 101, response.statusMessage ?? 'Switching Protocols', safeRawHeaders(response.rawHeaders, true));
			if (options.head.length > 0) upstreamSocket.write(options.head);
			if (upstreamHead.length > 0) options.socket.write(upstreamHead);
			upstreamSocket.pipe(options.socket);
			options.socket.pipe(upstreamSocket);
			finish('upgraded');
		});
		upstreamRequest.once('response', (response) => {
			writeResponse(options.socket, response.statusCode ?? 502, response.statusMessage ?? 'Bad Gateway', safeRawHeaders(response.rawHeaders, false));
			response.pipe(options.socket);
			finish('rejected');
		});
		upstreamRequest.once('error', (error) => {
			if (!settled && !options.socket.destroyed) writeError(options.socket, 502, 'admin-upstream-unavailable', error.message);
			finish('rejected');
		});
		upstreamRequest.end();
	});
}
