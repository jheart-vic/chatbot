import express from 'express'
import {
  createEmployee,
  listEmployees,
  updateEmployee
} from '../controllers/employeeController.js'

import { requireAdmin } from '../middleware/auth.js'

const router = express.Router()

router.post('/create-employee', requireAdmin, createEmployee)
router.get('/list-employees', requireAdmin, listEmployees)
router.put('/update-employee/:id', requireAdmin, updateEmployee)

export default router
