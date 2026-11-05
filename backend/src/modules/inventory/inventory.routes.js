// src/modules/inventory/inventory.routes.js
// Permissions follow the mock: staff have no inventory access; accountants can view stock,
// manage suppliers and pay them; item master, purchases, returns, stock-out and counts are admin-only.

import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { idempotency } from '../../middleware/idempotency.js';
import * as v from './inventory.schema.js';
import * as c from './inventory.controller.js';

const ADMINS = ['SUPER_ADMIN', 'ADMIN'];
const BACK_OFFICE = [...ADMINS, 'ACCOUNTANT'];

// ── /inventory ───────────────────────────────────────────────────────────────
export const inventoryRoutes = Router();
inventoryRoutes.use(authenticate, authorize(...BACK_OFFICE));
inventoryRoutes.get('/items',               validate(v.itemsQuery, 'query'), c.listItems);
inventoryRoutes.get('/items/:id',           c.getItem);
inventoryRoutes.get('/items/:id/stock',     validate(v.branchQuery, 'query'), c.itemStock);
inventoryRoutes.post('/items',              authorize(...ADMINS), validate(v.createItemSchema), c.createItem);
inventoryRoutes.put('/items/:id',           authorize(...ADMINS), validate(v.updateItemSchema), c.updateItem);
inventoryRoutes.post('/items/:id/archive',  authorize(...ADMINS), validate(v.archiveSchema), c.archiveItem);
inventoryRoutes.get('/stock-levels',        validate(v.branchQuery, 'query'), c.stockLevels);
inventoryRoutes.get('/consumption-preview', validate(v.consumptionPreviewQuery, 'query'), c.consumptionPreview);
inventoryRoutes.get('/summary',             validate(v.branchQuery, 'query'), c.summary);
inventoryRoutes.get('/cogs-report',         validate(v.cogsQuery, 'query'), c.cogs);
inventoryRoutes.get('/batches',             validate(v.batchesQuery, 'query'), c.listBatches);
inventoryRoutes.post('/batches/:id/quarantine', authorize(...ADMINS), validate(v.quarantineSchema), c.quarantine);
inventoryRoutes.post('/batches/:id/release',    authorize(...ADMINS), c.release);

// ── /suppliers ───────────────────────────────────────────────────────────────
export const supplierRoutes = Router();
supplierRoutes.use(authenticate, authorize(...BACK_OFFICE));
supplierRoutes.get('/',              validate(v.suppliersQuery, 'query'), c.listSuppliers);
supplierRoutes.get('/:id',           c.getSupplier);
supplierRoutes.get('/:id/ledger',    validate(v.ledgerQuery, 'query'), c.ledger);
supplierRoutes.post('/',             validate(v.createSupplierSchema), c.createSupplier);
supplierRoutes.put('/:id',           validate(v.updateSupplierSchema), c.updateSupplier);
supplierRoutes.post('/:id/archive',  validate(v.archiveSchema), c.archiveSupplier);
supplierRoutes.post('/:id/payments/:paymentId/reverse', idempotency, validate(v.reversePaymentSchema), c.reversePayment);
supplierRoutes.post('/:id/payments', idempotency, validate(v.paySupplierSchema), c.pay);

// ── /purchases, /supplier-returns, /stock-movements, /stock-settlements ──────
export const purchaseRoutes = Router();
purchaseRoutes.use(authenticate, authorize(...BACK_OFFICE));
purchaseRoutes.get('/',    validate(v.purchasesQuery, 'query'), c.listPurchases);
purchaseRoutes.get('/:id', c.getPurchase);
purchaseRoutes.post('/',   authorize(...ADMINS), idempotency, validate(v.createPurchaseSchema), c.createPurchase);

export const supplierReturnRoutes = Router();
supplierReturnRoutes.use(authenticate, authorize(...BACK_OFFICE));
supplierReturnRoutes.get('/',  validate(v.branchQuery, 'query'), c.listReturns);
supplierReturnRoutes.post('/', authorize(...ADMINS), idempotency, validate(v.createReturnSchema), c.createReturn);

export const stockMovementRoutes = Router();
stockMovementRoutes.use(authenticate, authorize(...BACK_OFFICE));
stockMovementRoutes.get('/',            validate(v.movementsQuery, 'query'), c.listMovements);
stockMovementRoutes.post('/manual-out', authorize(...ADMINS), idempotency, validate(v.stockOutSchema), c.stockOut);
stockMovementRoutes.post('/:id/reverse', authorize(...ADMINS), idempotency, validate(v.reverseStockMovementSchema), c.reverseMovement);

export const stockSettlementRoutes = Router();
stockSettlementRoutes.use(authenticate, authorize(...ADMINS));
stockSettlementRoutes.get('/',    validate(v.branchQuery, 'query'), c.listCounts);
stockSettlementRoutes.get('/:id', c.getCount);
stockSettlementRoutes.post('/',   idempotency, validate(v.stockSettlementSchema), c.createCount);
