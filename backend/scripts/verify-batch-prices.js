import prisma from '../src/config/prisma.js';
try {
 const missing = await prisma.inventoryBatch.count({ where: { sellingPrice: null } });
 const totals = await prisma.$queryRaw`SELECT "branchId", "itemId", sum("remainingQuantity") AS quantity,
 sum("remainingQuantity" * "unitCost") AS "costValue", sum("remainingQuantity" * "sellingPrice") AS "retailValue"
 FROM "InventoryBatch" GROUP BY 1,2 ORDER BY 1,2`;
 console.log(JSON.stringify({ missing, totals }, null, 2));
 if (missing) process.exitCode = 1;
} finally { await prisma.$disconnect(); }
