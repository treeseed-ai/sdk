import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { releaseEvidenceSchema } from '../../src/development/index.ts';

const root = resolve(import.meta.dirname, '../..');
const evidence = releaseEvidenceSchema.parse(JSON.parse(readFileSync(resolve(root, '.treeseed/standards/release-evidence-v1.json'), 'utf8')));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (evidence.candidate.sourceCommit !== commit) throw new Error('Release custody belongs to a different source commit.');
if (process.env.GITHUB_REF?.startsWith('refs/tags/') && process.env.GITHUB_REF_NAME !== evidence.packages[0]?.version) throw new Error('Release tag does not identify the sealed package version.');
for (const artifact of evidence.artifacts) {
	const path = resolve(root, artifact.identity), local = relative(root, path);
	if (local.startsWith('..') || isAbsolute(local)) throw new Error(`Release artifact escapes custody root: ${artifact.identity}.`);
	const actual = `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
	if (actual !== artifact.digest) throw new Error(`Release artifact digest mismatch: ${artifact.identity}.`);
}
console.log(JSON.stringify({ ok: true, sourceCommit: commit, candidateId: evidence.candidate.id, artifacts: evidence.artifacts.length }));
