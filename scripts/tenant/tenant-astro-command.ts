import { resolveAstroBin, runNodeBinary } from '../../src/operations/services/agents/runtime-tools.ts';

const args = process.argv.slice(2);

runNodeBinary(resolveAstroBin(), args, { cwd: process.cwd() });
