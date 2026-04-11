import { resolveAstroBin, runNodeBinary } from '../src/operations/services/runtime-tools.ts';

const args = process.argv.slice(2);

runNodeBinary(resolveAstroBin(), args, { cwd: process.cwd() });
