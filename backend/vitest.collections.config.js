import { defineConfig } from 'vitest/config';

// Deliberately no globalSetup: these regressions never connect to or reset a database.
export default defineConfig({ test: { environment: 'node', include: ['tests/collection-reporting.test.js'] } });
