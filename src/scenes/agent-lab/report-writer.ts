import { createServer,type Server } from 'node:http';
import { watchFile,unwatchFile } from 'node:fs';
import { mkdir,readFile,rename,writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentLabPresentationAdapter,AgentLabSnapshot } from '../types.ts';

export const AGENT_SIMULATOR_PORT = 4760;

function simulatorPort() {
	const configured = Number(process.env.TREESEED_AGENT_SIMULATOR_PORT ?? AGENT_SIMULATOR_PORT);
	if (!Number.isInteger(configured) || configured < 1 || configured > 65_535) throw new Error('TREESEED_AGENT_SIMULATOR_PORT must be a valid TCP port.');
	return configured;
}

function listen(server: Server) {
	const port = simulatorPort();
	return new Promise<number>((resolve, reject) => {
		server.once('error', (error: NodeJS.ErrnoException) => reject(error.code === 'EADDRINUSE'
			? new Error(`Agent Lab is already active at http://127.0.0.1:${port}/. End or inspect that simulation before starting another.`)
			: error));
		server.listen(port, '127.0.0.1', () => resolve(port));
	});
}

export async function writeAgentLabHtml(path: string, adapter: AgentLabPresentationAdapter, snapshot: AgentLabSnapshot) {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temporary, adapter.render(snapshot), 'utf8');
	await rename(temporary, path);
}

export type AgentLabLiveReport = {
	url: string;
	publish(snapshot: AgentLabSnapshot): Promise<void>;
	close(): Promise<void>;
};

function embeddedSnapshot(html: string) {
	const marker = '<script type="application/json" id="agent-lab-data">';
	const start = html.indexOf(marker);
	const end = start < 0 ? -1 : html.indexOf('</script>', start + marker.length);
	if (start < 0 || end < 0) throw new Error('The report does not contain embedded agent simulation evidence.');
	return JSON.parse(html.slice(start + marker.length, end)) as AgentLabSnapshot;
}

export async function startAgentLabReportViewer(path: string): Promise<AgentLabLiveReport> {
	let html = await readFile(path, 'utf8');
	let snapshot = embeddedSnapshot(html);
	let revision = 0;
	const clients = new Set<import('node:http').ServerResponse>();
	const server: Server = createServer((request, response) => {
		if (request.url === '/status') {
			response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
			response.end(JSON.stringify({ ok: true, active: snapshot.status === 'running' || snapshot.status === 'starting', status: snapshot.status, sceneId: snapshot.sceneId, runId: snapshot.runId, generatedAt: snapshot.generatedAt }));
			return;
		}
		if (request.url === '/snapshot') {
			response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
			response.end(JSON.stringify({ schemaVersion: 'treeseed.agent-simulation-stream/v1', kind: 'bootstrap', revision, snapshot }));
			return;
		}
		if (request.url === '/events') {
			response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
			clients.add(response); request.on('close', () => clients.delete(response)); return;
		}
		if (request.url !== '/' && request.url !== '/report.html') { response.writeHead(404).end('Not found'); return; }
		response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); response.end(html);
	});
	const port = await listen(server);
	const refresh = async () => {
		try {
			html = await readFile(path, 'utf8'); snapshot = embeddedSnapshot(html); revision += 1;
			const message = `id: ${revision}\nevent: delta\ndata: ${JSON.stringify({ schemaVersion: 'treeseed.agent-simulation-stream/v1', kind: 'upsert', revision, entity: 'simulation', id: snapshot.runId, value: snapshot })}\n\n`;
			for (const client of clients) client.write(message);
		} catch { /* Atomic rewrites may briefly replace the watched inode; the next observation retries. */ }
	};
	watchFile(path, { interval: 750 }, (current, previous) => { if (current.mtimeMs !== previous.mtimeMs) void refresh(); });
	return {
		url: `http://127.0.0.1:${port}/`,
		publish: async () => {},
		close: () => new Promise<void>((resolve) => { unwatchFile(path); for (const client of clients) client.end(); server.close(() => resolve()); }),
	};
}

export async function startAgentLabLiveReport(input: { path: string; adapter: AgentLabPresentationAdapter; initial: AgentLabSnapshot }): Promise<AgentLabLiveReport> {
	let snapshot = input.initial;
	let revision = 0;
	const clients = new Set<import('node:http').ServerResponse>();
	await writeAgentLabHtml(input.path, input.adapter, snapshot);
	const server: Server = createServer(async (request, response) => {
		if (request.url === '/status') {
			response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
			response.end(JSON.stringify({ ok: true, active: snapshot.status === 'running' || snapshot.status === 'starting', status: snapshot.status, sceneId: snapshot.sceneId, runId: snapshot.runId, generatedAt: snapshot.generatedAt }));
			return;
		}
		if (request.url === '/snapshot') {
			response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
			response.end(JSON.stringify({ schemaVersion: 'treeseed.agent-simulation-stream/v1', kind: 'bootstrap', revision, snapshot }));
			return;
		}
		if (request.url === '/events') {
			response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
			clients.add(response);
			request.on('close', () => clients.delete(response));
			return;
		}
		if (request.url !== '/' && request.url !== '/report.html') { response.writeHead(404).end('Not found'); return; }
		response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
		response.end(input.adapter.render(snapshot));
	});
	const port = await listen(server);
	return {
		url: `http://127.0.0.1:${port}/`,
		async publish(next) {
			snapshot = next;
			revision += 1;
			await writeAgentLabHtml(input.path, input.adapter, snapshot);
			const message = `id: ${revision}\nevent: delta\ndata: ${JSON.stringify({ schemaVersion: 'treeseed.agent-simulation-stream/v1', kind: 'upsert', revision, entity: 'simulation', id: snapshot.runId, value: snapshot })}\n\n`;
			for (const client of clients) client.write(message);
		},
		close: () => new Promise<void>((resolve) => { for (const client of clients) client.end(); server.close(() => resolve()); }),
	};
}
