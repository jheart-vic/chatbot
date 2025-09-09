// helpers/employeeAssignment.js
import Employee from "../models/Employee.js";
import Notification from "../models/Notification.js";
import Order from "../models/Order.js";

/**
 * Auto-assigns order to least-loaded employee.
 * - Prefers a given role (washer, ironer, delivery, etc.)
 * - Falls back to any employee if none in that role exist.
 * - Updates the order with both requested + actual role.
 */
export const assignEmployee = async (orderId, role) => {
  if (!role) return null;

  let employee = await Employee.findOneAndUpdate(
    { role },
    { $inc: { dailyOrders: 1, weeklyOrders: 1 } },
    { new: true, sort: { dailyOrders: 1, weeklyOrders: 1 } }
  );

  let actualRole = role;

  // Fallback if no employee in that role
  if (!employee) {
    employee = await Employee.findOneAndUpdate(
      {},
      { $inc: { dailyOrders: 1, weeklyOrders: 1 } },
      { new: true, sort: { dailyOrders: 1, weeklyOrders: 1 } }
    );

    if (employee) {
      actualRole = employee.role;
      await Notification.create({
        employee: employee._id,
        type: "assignment",
        message: `⚠️ Assigned to ${role} task due to no available ${role}s. Actual role: ${employee.role}`,
      });
    }
  }

  // Update order with assignment info
  if (employee) {
    await Order.findByIdAndUpdate(orderId, {
      assignedTo: employee._id,
      assignedRoleRequested: role,
      assignedRoleActual: actualRole,
    });
  }

  return employee;
};
