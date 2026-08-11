import { createServer, type Server } from 'node:http';
import { createConnection, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { proxyNodeWebSocketUpgrade } from '../../../src/gateway/node-websocket-proxy.ts';

const routes = [{ method: 'GET', path: '/v1/session/events' }] as const;
const servers: Server[] = [];
const sockets: Duplex[] = [];

async function listen(server: Server) {
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Expected a TCP server address.');
	return address.port;
}

function connect(port: number) {
	return new Promise<Socket>((resolve, reject) => {
		const socket = createConnection({ host: '127.0.0.1', port }, () => resolve(socket));
		sockets.push(socket);
		socket.once('error', reject);
	});
}

function readUntil(socket: Socket, pattern: string) {
	return new Promise<string>((resolve, reject) => {
		let observed = '';
		const onData = (chunk: Buffer) => {
			observed += chunk.toString();
			if (!observed.includes(pattern)) return;
			socket.off('data', onData);
			resolve(observed);
		};
		socket.on('data', onData);
		socket.once('error', reject);
	});
}

afterEach(async () => {
	for (const socket of sockets.splice(0)) socket.destroy();
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
		server.closeAllConnections();
		server.close(() => resolve());
	})));
});

describe('Node WebSocket Admin proxy', () => {
	it('admits an exact descriptor route and bridges the upgraded socket with safe headers', async () => {
		let upstreamHeaders: typeof import('node:http').IncomingHttpHeaders = {};
		const upstream = createServer();
		upstream.on('upgrade', (request, socket) => {
			sockets.push(socket);
			upstreamHeaders = request.headers;
			socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: fixture\r\nSet-Cookie: session=next; Path=/; Secure\r\nSet-Cookie: csrf=next; Path=/; Secure\r\nX-Treeseed-Internal-Secret: never-return\r\n\r\n');
			socket.on('data', (chunk) => socket.write(chunk));
		});
		const upstreamPort = await listen(upstream);
		const gateway = createServer();
		gateway.on('upgrade', (incoming, socket, head) => {
			sockets.push(socket);
			void proxyNodeWebSocketUpgrade({
				adminBaseUrl: `http://127.0.0.1:${upstreamPort}`,
				adminRoutes: routes,
				incoming,
				socket,
				head,
				serviceAssertion: () => 'signed',
			});
		});
		const gatewayPort = await listen(gateway);
		const client = await connect(gatewayPort);
		client.write('GET /v1/session/events?transport=websocket HTTP/1.1\r\nHost: api.treeseed.dev\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: fixture\r\nSec-WebSocket-Version: 13\r\nCookie: session=current\r\nX-Request-Id: request-1\r\nX-Treeseed-Internal-Secret: never-forward\r\n\r\n');
		const handshake = await readUntil(client, '\r\n\r\n');

		expect(handshake).toContain('101 Switching Protocols');
		expect(handshake.match(/Set-Cookie:/gu)).toHaveLength(2);
		expect(handshake).not.toContain('never-return');
		expect(upstreamHeaders.cookie).toBe('session=current');
		expect(upstreamHeaders['x-request-id']).toBe('request-1');
		expect(upstreamHeaders['x-treeseed-service-assertion']).toBe('signed');
		expect(upstreamHeaders['x-treeseed-internal-secret']).toBeUndefined();
		const echoed = readUntil(client, 'ping');
		client.write('ping');
		expect(await echoed).toContain('ping');
	});

	it('rejects undeclared upgrades without contacting the Admin upstream', async () => {
		let contacted = false;
		const upstream = createServer(() => { contacted = true; });
		upstream.on('upgrade', () => { contacted = true; });
		const upstreamPort = await listen(upstream);
		const gateway = createServer();
		gateway.on('upgrade', (incoming, socket, head) => {
			void proxyNodeWebSocketUpgrade({ adminBaseUrl: `http://127.0.0.1:${upstreamPort}`, adminRoutes: routes, incoming, socket, head });
		});
		const gatewayPort = await listen(gateway);
		const client = await connect(gatewayPort);
		client.write('GET /v1/undeclared HTTP/1.1\r\nHost: api.treeseed.dev\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
		const response = await readUntil(client, 'admin-route-not-declared');

		expect(response).toContain('404 Not Found');
		expect(response).toContain('admin-route-not-declared');
		expect(contacted).toBe(false);
	});

	it('returns a structured timeout when Admin never completes the upgrade', async () => {
		const upstream = createServer();
		upstream.on('upgrade', (_request, socket) => { sockets.push(socket); });
		const upstreamPort = await listen(upstream);
		const gateway = createServer();
		gateway.on('upgrade', (incoming, socket, head) => {
			sockets.push(socket);
			void proxyNodeWebSocketUpgrade({ adminBaseUrl: `http://127.0.0.1:${upstreamPort}`, adminRoutes: routes, incoming, socket, head, timeoutMs: 10 });
		});
		const gatewayPort = await listen(gateway);
		const client = await connect(gatewayPort);
		client.write('GET /v1/session/events HTTP/1.1\r\nHost: api.treeseed.dev\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
		const response = await readUntil(client, 'admin-upstream-timeout');

		expect(response).toContain('504 Gateway Timeout');
	});
});
