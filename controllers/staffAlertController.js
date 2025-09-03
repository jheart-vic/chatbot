import StaffAlert from "../models/StaffAlert.js";

// Create new alert
export const createAlert = async (req, res) => {
  try {
    const { orderId, type, message, staffAssigned } = req.body;

    let autoMessage = message;
    if (type === "order-delay") {
      autoMessage = `⚠️ Order ${orderId} is delayed. Please follow up.`;
    }
    if (type === "inventory-low") {
      autoMessage = `⚠️ Inventory is running low. Restock needed.`;
    }

    const alert = await StaffAlert.create({
      orderId,
      type,
      message: autoMessage,
      staffAssigned,
    });

    // 🔔 Notify staff via WhatsApp/Email here
    res.json({ success: true, alert });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// Get unresolved alerts
export const getUnresolvedAlerts = async (req, res) => {
  try {
    const alerts = await StaffAlert.find({ resolved: false }).populate("orderId").populate("staffAssigned");
    res.json({ success: true, alerts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Mark alert as resolved
export const resolveAlert = async (req, res) => {
  try {
    const { id } = req.params;
    const alert = await StaffAlert.findByIdAndUpdate(id, { resolved: true }, { new: true });
    res.json({ success: true, alert });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
