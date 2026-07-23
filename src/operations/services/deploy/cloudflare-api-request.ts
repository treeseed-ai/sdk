import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { resolveTreeseedWebCachePolicy } from '../../../platform/deploy-config.ts';
import {
	deleteRailwayCustomDomain,
	deleteRailwayEnvironment,
	deleteRailwayVolume,
	getRailwayServiceInstance,
	listRailwayCustomDomains,
	listRailwayProjects,
	listRailwayVariables,
	listRailwayVolumes,
	normalizeRailwayEnvironmentName,
	resolveRailwayApiToken,
	resolveRailwayWorkspace,
	resolveRailwayWorkspaceContext,
} from '../railway-api.ts';
import { loadCliDeployConfig, resolveWranglerBin } from '../runtime-tools.ts';
import { sdkD1MigrationsRoot } from '../runtime-paths.ts';
import { sleepSync } from './default-compatibility-date.ts';

export function cloudflareApiRequest(path, { method = 'GET', body, env, allowFailure = false } = {}) {
	const token = env?.TREESEED_CLOUDFLARE_API_TOKEN ?? env?.CLOUDFLARE_API_TOKEN ?? process.env.TREESEED_CLOUDFLARE_API_TOKEN ?? '';
	if (!token) {
		if (allowFailure) {
			return null;
		}
		throw new Error(`Cloudflare API token is required: ${method} ${path}`);
	}

	const requestScript = `import { readFileSync } from 'node:fs';
import { request } from 'node:https';
const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
function errorMessage(error) {
  const parts = [];
  if (error && typeof error.message === 'string') parts.push(error.message);
  const cause = error?.cause;
  if (cause && typeof cause.message === 'string') parts.push(cause.message);
  if (cause && typeof cause.code === 'string') parts.push(cause.code);
  if (Array.isArray(cause?.errors)) {
    for (const entry of cause.errors) {
      if (entry && typeof entry.message === 'string') parts.push(entry.message);
      if (entry && typeof entry.code === 'string') parts.push(entry.code);
    }
  }
  return [...new Set(parts.filter(Boolean))].join('; ') || String(error);
}
try {
  const body = input.body ? JSON.stringify(input.body) : undefined;
  const response = await new Promise((resolve, reject) => {
    const req = request(input.url, {
      method: input.method,
      headers: {
        authorization: 'Bearer ' + input.token,
        'content-type': 'application/json',
      },
      timeout: input.timeoutMs ?? 12000,
    }, (res) => {
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        ok: typeof res.statusCode === 'number' && res.statusCode >= 200 && res.statusCode < 300,
        text: chunks.join(''),
      }));
    });
    req.on('timeout', () => {
      req.destroy(new Error('Cloudflare API request timed out'));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
  const rawBody = response.text;
  let payload;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    payload = { success: false, errors: [{ message: rawBody || 'empty response' }] };
  }
  process.stdout.write(JSON.stringify({ ok: response.ok, payload }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    transient: true,
    payload: { success: false, errors: [{ message: errorMessage(error) }] },
  }));
}`;
	const requestInput = JSON.stringify({
		url: `https://api.cloudflare.com/client/v4${path}`,
		method,
		body,
		timeoutMs: 12_000,
		token,
	});
	const isTransient = (text) => /fetch failed|timed out|etimedout|econnreset|enetunreach|temporarily unavailable|aborted|rate limit|too many requests|throttl|please wait/iu.test(text || '');
	const retryDelay = (text, currentAttempt) => {
		const base = /rate limit|too many requests|throttl|please wait/iu.test(text || '') ? 2500 : 500;
		return base * (currentAttempt + 1);
	};
	const formatPayloadErrors = (payload) => Array.isArray(payload?.errors)
		? payload.errors.map((entry) => entry?.message ?? JSON.stringify(entry)).join('; ')
		: '';
	const summarizeChildError = (text) => {
		const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
		return lines.find((line) => /fetch failed|timed out|etimedout|econnreset|enetunreach|temporarily unavailable|aborted|typeerror|error/iu.test(line))
			?? lines[0]
			?? '';
	};
	let attempt = 0;
	for (;;) {
		const response = spawnSync(
			process.execPath,
			[
				'--input-type=module',
				'-e',
				requestScript,
			],
			{
				stdio: ['pipe', 'pipe', 'pipe'],
				encoding: 'utf8',
				env: { ...process.env, ...(env ?? {}) },
				input: requestInput,
				timeout: 15000,
			},
		);
		if (response.error?.code === 'ETIMEDOUT') {
			if (attempt < 7) {
				attempt += 1;
				sleepSync(retryDelay('timed out', attempt));
				continue;
			}
			if (!allowFailure) {
				throw new Error(`Cloudflare API request timed out after ${attempt + 1} attempts: ${method} ${path}`);
			}
			return null;
		}
		const stderr = response.stderr?.trim() || '';
		if (response.status !== 0) {
			if (attempt < 7 && isTransient(stderr)) {
				attempt += 1;
				sleepSync(retryDelay(stderr, attempt));
				continue;
			}
			if (!allowFailure) {
				const detail = summarizeChildError(stderr);
				throw new Error(detail
					? `Cloudflare API request failed after ${attempt + 1} attempts: ${method} ${path}: ${detail}`
					: `Cloudflare API request failed after ${attempt + 1} attempts: ${method} ${path}`);
			}
		}

		let parsed;
		try {
			parsed = JSON.parse(response.stdout?.trim() || '{"ok":false,"payload":{"success":false,"errors":[{"message":"empty response"}]}}');
		} catch {
			parsed = {
				ok: false,
				payload: {
					success: false,
					errors: [{ message: response.stdout?.trim() || stderr || 'empty response' }],
				},
			};
		}
		const details = formatPayloadErrors(parsed.payload);
		if (!parsed.ok && isTransient(details) && attempt < 7) {
			attempt += 1;
			sleepSync(retryDelay(details, attempt));
			continue;
		}
		if (!parsed.ok && !allowFailure) {
			throw new Error(details
				? `Cloudflare API request failed after ${attempt + 1} attempts: ${method} ${path}: ${details}`
				: `Cloudflare API request failed after ${attempt + 1} attempts: ${method} ${path}`);
		}
		return parsed.payload;
	}
}

export function resolveCloudflareZoneIdForHost(deployConfig, host, env) {
	if (deployConfig.cloudflare.zoneId) {
		return deployConfig.cloudflare.zoneId;
	}

	const result = cloudflareApiRequest(`/zones?name=${encodeURIComponent(host)}`, { env, allowFailure: true });
	const exact = Array.isArray(result?.result) ? result.result.find((zone) => zone?.name === host) : null;
	if (exact?.id) {
		return exact.id;
	}

	const fallback = cloudflareApiRequest('/zones', { env, allowFailure: true });
	const zones = Array.isArray(fallback?.result) ? fallback.result : [];
	const matched = zones
		.filter((zone) => typeof zone?.name === 'string' && (host === zone.name || host.endsWith(`.${zone.name}`)))
		.sort((left, right) => String(right.name).length - String(left.name).length)[0];
	return matched?.id ?? null;
}

export function listCloudflareZoneRulesets(zoneId, env) {
	const result = cloudflareApiRequest(`/zones/${zoneId}/rulesets`, { env, allowFailure: true });
	return Array.isArray(result?.result) ? result.result : [];
}

export function joinCloudflareAndExpression(clauses) {
	const parts = clauses
		.map((clause) => typeof clause === 'string' ? clause.trim() : '')
		.filter((clause) => clause.length > 0)
		.map((clause) => clause.startsWith('(') && clause.endsWith(')') ? clause : `(${clause})`);
	if (parts.length === 0) {
		throw new Error('Cannot build a Cloudflare expression without predicates.');
	}
	return `(${parts.join(' and ')})`;
}
