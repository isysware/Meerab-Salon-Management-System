import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/batch-pricing.test.js',
      'tests/inventory-fifo-fefo.test.js',
      'tests/supplier-payment-reporting.test.js',
      'tests/salon-consumption.test.js',
    ],
  },
});
