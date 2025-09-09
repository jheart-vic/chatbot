// controllers/financeController.js
import MonthlyFinance from "../models/MonthlyFinance.js";

export const getMonthlyReport = async (req, res) => {
  try {
    const { month } = req.query; // e.g. "2025-09"
    const report = await MonthlyFinance.findOne({ month });
    if (!report) return res.status(404).json({ success: false, message: "No report found" });

    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const listMonthlyReports = async (req, res) => {
  try {
    const reports = await MonthlyFinance.find().sort({ month: -1 }).limit(12);
    res.json({ success: true, reports });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
