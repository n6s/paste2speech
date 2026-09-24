// Backward-compatible entry point; staging and production share one release path.
process.argv.push('--production');
await import('./release-reader.mjs');
