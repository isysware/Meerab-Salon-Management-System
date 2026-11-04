import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['tests/salary-ledger-reconciliation.test.js'] } });
