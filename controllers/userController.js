import User from "../models/User.js";

// Create or update user (onboarding)
export const onboardUser = async (req, res) => {
  try {
    const { fullName, phone, address, preferences } = req.body;

    let user = await User.findOne({ phone });
    if (user) {
      if (!user.fullName && fullName) user.fullName = fullName;
      if (!user.address && address) user.address = address;
      if (preferences) user.preferences = { ...user.preferences, ...preferences };
      await user.save();
    } else {
      user = await User.create({ fullName, phone, address, preferences });
    }

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Update user preferences
export const updatePreferences = async (req, res) => {
  try {
    const { phone, preferences } = req.body;
    const user = await User.findOneAndUpdate(
      { phone },
      { $set: { preferences } },
      { new: true }
    );
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get user loyalty balance
export const getLoyaltyBalance = async (req, res) => {
  try {
    const { phone } = req.params;
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    res.json({
      success: true,
      loyaltyBalance: user.loyaltyBalance,
      totalOrders: user.totalOrders,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
