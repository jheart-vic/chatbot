// controllers/expenseController.js
import Expense from "../models/Expense.js";

// ➕ Add new expense
export const addExpense = async (req, res) => {
  try {
    const { description, amount, category, recordedBy } = req.body;
    const expense = await Expense.create({ description, amount, category, recordedBy });
    res.json({ success: true, expense });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// 📋 List expenses (filter by date/category)
export const listExpenses = async (req, res) => {
  try {
    const { startDate, endDate, category } = req.query;
    const q = {};
    if (startDate && endDate) q.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    if (category) q.category = category;

    const expenses = await Expense.find(q).sort({ date: -1 });
    res.json({ success: true, expenses });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// 💰 Get total expenses for a date range
export const getExpenseSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const q = {};
    if (startDate && endDate) q.date = { $gte: new Date(startDate), $lte: new Date(endDate) };

    const result = await Expense.aggregate([
      { $match: q },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
    ]);

    res.json({ success: true, summary: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
