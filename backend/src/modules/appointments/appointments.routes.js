// src/modules/appointments/appointments.routes.js

import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import * as v from './appointments.schema.js';
import * as c from './appointments.controller.js';

const APPOINTMENT_ROLES = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'STAFF'];

const router = Router();
router.use(authenticate);

router.get('/',       authorize(...APPOINTMENT_ROLES), validate(v.listQuery, 'query'), c.list);
router.get('/queue',  authorize(...APPOINTMENT_ROLES), validate(v.queueQuery, 'query'), c.queue);
router.get('/:id',    authorize(...APPOINTMENT_ROLES), c.getOne);
router.get('/:id/confirmation-message', authorize(...APPOINTMENT_ROLES), c.confirmation);

router.post('/',                authorize(...APPOINTMENT_ROLES), validate(v.createSchema), c.create);
router.put('/:id',              authorize(...APPOINTMENT_ROLES), validate(v.updateSchema), c.update);
router.patch('/:id/status',     authorize(...APPOINTMENT_ROLES), validate(v.statusSchema), c.updateStatus);
router.post('/:id/reschedule',  authorize(...APPOINTMENT_ROLES), validate(v.rescheduleSchema), c.reschedule);

export default router;
