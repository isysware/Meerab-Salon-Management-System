// src/modules/inventory/inventory.controller.js

import * as s from './inventory.service.js';
import { postingRequest } from '../../lib/paymentPosting.js';
import { asyncHandler } from '../../lib/asyncHandler.js';

const send = (fn, status = 200) => asyncHandler(async (req, res) => {
  res.status(status).json({ data: await fn(req) });
});

// Items & stock
export const listItems     = send((req) => s.listItems(req.user, req.query));
export const getItem       = send((req) => s.getItem(req.params.id));
export const createItem    = send((req) => s.createItem(req.body, req.user), 201);
export const updateItem    = send((req) => s.updateItem(req.params.id, req.body, req.user));
export const archiveItem   = send((req) => s.archiveItem(req.params.id, req.body.isActive, req.user));
export const stockLevels   = send((req) => s.stockSnapshots(req.user, req.query.branchId));
export const itemStock     = send((req) => s.itemStock(req.user, req.params.id, req.query.branchId));
export const summary       = send((req) => s.inventorySummary(req.user, req.query.branchId));
export const cogs          = send((req) => s.cogsReport(req.user, req.query));

// Batches
export const listBatches   = send((req) => s.listBatches(req.user, req.query));
export const quarantine    = send((req) => s.quarantineBatch(req.user, req.params.id, req.body.reason));
export const release       = send((req) => s.releaseBatch(req.user, req.params.id));

// Suppliers
export const listSuppliers   = send((req) => s.listSuppliers(req.user, req.query));
export const getSupplier     = send((req) => s.getSupplier(req.user, req.params.id));
export const createSupplier  = send((req) => s.createSupplier(req.body, req.user), 201);
export const updateSupplier  = send((req) => s.updateSupplier(req.params.id, req.body, req.user));
export const archiveSupplier = send((req) => s.archiveSupplier(req.params.id, req.body.isActive, req.user));
export const ledger          = send((req) => s.supplierLedger(req.user, req.params.id, req.query));
export const pay             = send((req) => s.paySupplier({ ...req.body, supplierId: req.params.id }, req.user, postingRequest(req)), 201);
export const refund          = send((req) => s.recordSupplierRefund({ ...req.body, supplierId: req.params.id }, req.user), 201);

// Purchases, returns, movements, counts
export const listPurchases   = send((req) => s.listPurchases(req.user, req.query));
export const getPurchase     = send((req) => s.getPurchase(req.user, req.params.id));
export const createPurchase  = send((req) => s.createPurchase(req.body, req.user, postingRequest(req)), 201);
export const listReturns     = send((req) => s.listReturns(req.user, req.query));
export const createReturn    = send((req) => s.createReturn(req.body, req.user), 201);
export const listMovements      = send((req) => s.listMovements(req.user, req.query));
export const stockOut           = send((req) => s.manualStockOut(req.body, req.user), 201);
export const consumptionPreview = send((req) => s.consumptionPreview(req.user, req.query));
export const reverseMovement    = send((req) => s.reverseMovement(req.user, req.params.id, req.body), 201);
export const listCounts         = send((req) => s.listStockSettlements(req.user, req.query));
export const getCount        = send((req) => s.getStockSettlement(req.user, req.params.id));
export const createCount     = send((req) => s.createStockSettlement(req.body, req.user), 201);

export const reversePayment = send((req) => s.reverseSupplierPayment({ ...req.body, supplierId: req.params.id, paymentId: req.params.paymentId }, req.user, postingRequest(req)), 201);
