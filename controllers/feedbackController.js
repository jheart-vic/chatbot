// controllers/feedbackController.js
import Feedback from "../models/Feedback.js";
import Employee from "../models/Employee.js";
import Order from "../models/Order.js";
import StaffAlert from "../models/StaffAlert.js";

// Create feedback for completed order
export const createFeedback = async (req, res) => {
  try {
    const { orderId, userId, rating, comment, complaint } = req.body;

    // Ensure order exists
    const order = await Order.findById(orderId).populate("assignedTo");
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    // Save feedback
    const feedback = await Feedback.create({
      orderId,
      userId,
      rating,
      comment,
      complaint: !!complaint,
    });

    // If order has an assigned employee, update their performance
    if (order?.assignedTo) {
      const employee = await Employee.findById(order.assignedTo._id);

      if (employee) {
        // Link feedback
        if (!employee.feedbacks) employee.feedbacks = [];
        employee.feedbacks.push(feedback._id);

        // Recalculate quality score (average of all ratings for this employee)
        const feedbacks = await Feedback.find({ orderId });
        const avgScore =
          feedbacks.length > 0
            ? feedbacks.reduce((a, b) => a + b.rating, 0) / feedbacks.length
            : employee.qualityScore;

        employee.qualityScore = avgScore;

        // Count mistakes if complaint is true
        if (complaint) {
          employee.mistakes += 1;

          // 🚨 Trigger staff alert
          await StaffAlert.create({
            orderId,
            type: "customer-complaint",
            message: `Customer ${userId} left a complaint on order ${orderId}.`,
            staffAssigned: employee._id,
            priority: "high",
          });
        }

        await employee.save();
      }
    }

    res.json({ success: true, feedback });
  } catch (err) {
    console.error("❌ Feedback Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Get average rating across all feedback
export const getAverageRating = async (req, res) => {
  try {
    const result = await Feedback.aggregate([
      { $group: { _id: null, avgRating: { $avg: "$rating" } } },
    ]);
    const avg = result.length > 0 ? result[0].avgRating : 0;
    res.json({ success: true, average: avg });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// List feedback (filter by orderId or userId)
export const listFeedback = async (req, res) => {
  try {
    const { orderId, userId } = req.query;
    const q = {};
    if (orderId) q.orderId = orderId;
    if (userId) q.userId = userId;

    const items = await Feedback.find(q).sort({ createdAt: -1 }).lean();
    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
