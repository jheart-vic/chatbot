import mongoose from 'mongoose';
const userSchema = new mongoose.Schema (
  {
    fullName: {type: String}, // not required anymore
    whatsappName: {type: String},
    phone: {type: String, required: true, unique: true},
    address: {type: String},
    preferences: {
      fragrance: String,
      foldingStyle: String,
      ironingInstructions: String,
    },
    loyaltyBalance: {type: Number, default: 0},
    totalOrders: {type: Number, default: 0},
    isOnboarded: {type: Boolean, default: false},
    isStaff: {type: Boolean, default: false},
    conversationState: {
      step: {type: String, default: null},
      tempOrder: {type: Object, default: {}},
      linkDraft: {type: Object, default: {}}, // transient data during account linking (never the password)
    },
    // Linked Chuvi backend account/session
    chuvi: {
      userId: {type: String},
      email: {type: String},
      accessToken: {type: String},
      refreshToken: {type: String},
      linkedAt: {type: Date},
    },
    supportMode: {type: Boolean, default: false}, // true while escalated to a human agent
    lastInboundAt: {type: Date}, // last message we received from this user
    knownEmail: {type: String}, // last successfully linked email (kept after unlink)
    segment: {type: String, enum: ['student', 'professional', 'household'], default: 'student'},
    journey: {type: Object, default: {}}, // post-delivery & reactivation journey state
    // In-progress booking or inquiry the customer can resume later.
    // { kind: 'booking'|'inquiry', summary, data, updatedAt, resumedNudgeAt }
    draft: {type: Object, default: null},
  },
  {timestamps: true}
);

export default mongoose.model ('User', userSchema);
