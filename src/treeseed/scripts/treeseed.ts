#!/usr/bin/env node

import { runTreeseedCli } from '../cli/main.ts';

const exitCode = await runTreeseedCli(process.argv.slice(2));
process.exit(exitCode);
