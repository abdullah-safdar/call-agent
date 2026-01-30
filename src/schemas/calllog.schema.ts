import mongoose from "mongoose";


const callLogSchema = new mongoose.Schema({
  callId: { type: String, required: true, unique: true },
  // Twilio Call SID (CA...)
  callSid: { type: String, index: true },
  // ElevenLabs conversation id (conv_...)
  conversationId: { type: String, index: true },
  customerPhone: { type: String, required: true, index: true }, // Indexed for fast lookups by phone
  campaign: {
    name: { type: String, required: true },
    prompt: { type: String, required: true },
  },
  outcome: {
    type: String,
    enum: ["no_answer", "not_interested", "interested", "busy", "failed", "in_progress"],
    default: "in_progress",
    index: true, // Indexed for filtering by outcome
  },
  summary: { type: String, default: "" },
  conversation: [{
    role: { type: String, enum: ["ai", "customer"] },
    message: { type: String },
    timestamp: { type: Date, default: Date.now },
  }],
  callDuration: { type: Number, default: 0 },
  startedAt: { type: Date, default: Date.now },
  endedAt: { type: Date },
  twilioStatus: { type: String },
}, { timestamps: true });





callLogSchema.index({ customerPhone: 1, createdAt: -1 });
callLogSchema.index({ customerPhone: 1, outcome: 1 });

export default mongoose.model("CallLog", callLogSchema);