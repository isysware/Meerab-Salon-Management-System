// src/modules/staff/staff.routes.js

import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { createStaffSchema, updateStaffSchema, portalAccessSchema, listStaffQuery } from './staff.schema.js';
import * as c from './staff.controller.js';

const ADMINS = ['SUPER_ADMIN', 'ADMIN'];

const router = Router();
router.use(authenticate);

router.get('/',          authorize(...ADMINS, 'ACCOUNTANT', 'STAFF'), validate(listStaffQuery, 'query'), c.list);
router.get('/next-code', authorize(...ADMINS), c.nextCode);
router.get('/:id',       authorize(...ADMINS, 'ACCOUNTANT', 'STAFF'), c.getOne);

router.post('/',                   authorize(...ADMINS), validate(createStaffSchema),  c.create);
router.put('/:id',                 authorize(...ADMINS), validate(updateStaffSchema),  c.update);
router.post('/:id/deactivate',     authorize(...ADMINS), c.deactivate);
router.post('/:id/portal-access',  authorize(...ADMINS), validate(portalAccessSchema), c.portalAccess);

export default router;
