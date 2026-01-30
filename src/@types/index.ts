// ───────────────── Marketing Campaign Data ─────────────────
export interface MarketingCampaign {
  name: string;
  prompt: string;
}

export interface ConversationEntry {
  role: "ai" | "customer";
  message: string;
  timestamp: Date;
}

// Store active calls with conversation tracking
export const activeCalls = new Map<string, {
  customerPhone: string;
  campaign: MarketingCampaign;
  // ElevenLabs conversation id (conv_...)
  conversationId?: string;
  // Twilio call sid (CA...)
  twilioCallSid?: string;
  // internal / debug
  lastStatus?: string;
  conversation: ConversationEntry[];
  startedAt: Date;
}>();