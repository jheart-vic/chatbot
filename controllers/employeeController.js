// controllers/employeeController.js
import Employee from "../models/Employee.js";

// Create/register employee
export const createEmployee = async (req, res) => {
  try {
    const { name, role } = req.body;
    const employee = await Employee.create({ name, role });
    res.json({ success: true, employee });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// List employees
export const listEmployees = async (req, res) => {
  try {
    const employees = await Employee.find().sort({ createdAt: -1 });
    res.json({ success: true, employees });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Update employee role or stats
export const updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    const employee = await Employee.findByIdAndUpdate(
      id,
      { role },
      { new: true }
    );
    res.json({ success: true, employee });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
