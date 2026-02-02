import { MarketingCampaign, ConversationEntry } from "../../@types";
import CallLog from "../../schemas/calllog.schema";

export type CallState = {
  callId: string;
  customerPhone: string;
  campaign: MarketingCampaign;
  conversationId?: string;   // conv_...
  twilioCallSid?: string;    // CA...
  startedAt: string;         // ISO
  updatedAt: string;         // ISO
};

// MongoDB-only implementation - no Redis needed

export async function upsertCallState(state: CallState): Promise<void> {
  // State is already persisted in MongoDB via CallLog
  // This function is kept for API compatibility but does nothing
  // The actual state is stored when CallLog is created/updated
}

export async function getCallState(callId: string): Promise<CallState | null> {
  try {
    const log = await CallLog.findOne({ callId }).exec();
    if (!log) return null;

    return {
      callId: log.callId,
      customerPhone: log.customerPhone,
      campaign: {
        name: log.campaign?.name || "",
        prompt: log.campaign?.prompt || "",
      },
      conversationId: log.conversationId || undefined,
      twilioCallSid: log.callSid || undefined,
      startedAt: log.startedAt?.toISOString() || new Date().toISOString(),
      updatedAt: log.updatedAt?.toISOString() || new Date().toISOString(),
    };
  } catch (err) {
    console.error(`[getCallState] MongoDB lookup error:`, err);
    return null;
  }
}

export async function getCallIdByConversationId(conversationId: string): Promise<string | null> {
  try {
    const log = await CallLog.findOne({ conversationId }).select("callId").exec();
    return log?.callId || null;
  } catch (err) {
    console.error(`[getCallIdByConversationId] MongoDB lookup error:`, err);
    return null;
  }
}

export async function getCallIdByTwilioSid(twilioSid: string): Promise<string | null> {
  try {
    const log = await CallLog.findOne({ callSid: twilioSid }).select("callId").exec();
    return log?.callId || null;
  } catch (err) {
    console.error(`[getCallIdByTwilioSid] MongoDB lookup error:`, err);
    return null;
  }
}

export async function appendConversationEntry(callId: string, entry: ConversationEntry): Promise<void> {
  // Conversation entries are stored directly in MongoDB via CallLog
  // This function is kept for API compatibility but does nothing
  // The actual conversation is stored when the post-call webhook processes the transcript
}

export async function getConversation(callId: string): Promise<ConversationEntry[]> {
  try {
    const log = await CallLog.findOne({ callId }).select("conversation").exec();
    if (!log || !log.conversation || !Array.isArray(log.conversation)) {
      return [];
    }
    return log.conversation.map((c: any) => ({
      role: (c.role === "ai" || c.role === "agent" || c.role === "assistant") ? "ai" : "customer",
      message: String(c.message || c.text || c.content || ""),
      timestamp: c.timestamp || new Date(),
    }));
  } catch (err) {
    console.error(`[getConversation] MongoDB lookup error:`, err);
    return [];
  }
}
