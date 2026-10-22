#!/usr/bin/env node
import('../dist/cli.js').catch(error => {
  console.error('[flywheel] CLI unavailable:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
