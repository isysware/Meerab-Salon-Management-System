// src/modules/clients/clients.routes.js
// Accountants can look customers up (POS, dues) but only admins create/edit/archive them.

import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import * as v from './clients.schema.js';
import * as c from './clients.controller.js';

const ADMINS = ['SUPER_ADMIN', 'ADMIN'];
const BACK_OFFICE = [...ADMINS, 'ACCOUNTANT', 'STAFF'];

const router = Router();
router.use(authenticate);

router.get('/',             authorize(...BACK_OFFICE), validate(v.listClientsQuery, 'query'), c.list);
router.get('/search',       authorize(...BACK_OFFICE), validate(v.searchQuery, 'query'), c.search);
router.get('/:id',          authorize(...BACK_OFFICE), c.getOne);
router.post('/',            authorize(...ADMINS), validate(v.createClientSchema), c.create);
router.put('/:id',          authorize(...ADMINS), validate(v.updateClientSchema), c.update);
router.post('/:id/archive', authorize(...ADMINS), validate(v.archiveSchema), c.archive);

export default router;
