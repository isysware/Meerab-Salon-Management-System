import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
 resolve: { alias: { '@prisma/client': path.resolve('node_modules/.batch-pricing-client/index.js') } },
 test: { environment: 'node', include: ['tests/batch-pricing.test.js', 'tests/inventory-fifo-fefo.test.js', 'tests/batch-pricing.integration.test.js'],
 setupFiles: ['./tests/setupEnv.js'], fileParallelism: false, testTimeout: 30000, hookTimeout: 120000 }
});
