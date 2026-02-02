import { Request, Response } from "express";
import { MarketingCampaign } from "../../@types";
import {
  DEBUG_VERBOSE,
  ELEVEN_LABS_AGENT_ID,
  ELEVEN_LABS_API_KEY,
  ELEVEN_LABS_AGENT_PHONE_NUMBER_ID,
} from "../../constants";
import { activeCalls } from "../../@types";
import CallLog from "../../schemas/calllog.schema";
import { ts } from "../../utils";
import { determineOutcome } from "../prompt";
import { upsertCallState, getCallIdByConversationId } from "./callState";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

// Initialize ElevenLabs client globally
const elevenLabsClient = new ElevenLabsClient({
  environment: "https://api.elevenlabs.io",
  apiKey: ELEVEN_LABS_API_KEY,

});

// core call mechanism endpoint
export async function initiateCall(req: Request, res: Response) {
  try {
    const { customerPhone, campaign } = req.body as {
      customerPhone: string;
      campaign: MarketingCampaign;
    };

    if (!customerPhone) {
      return res.status(400).json({ error: "customerPhone is required" });
    }

    if (!campaign || !campaign.name) {
      return res.status(400).json({ error: "campaign with name is required" });
    }

    const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log(`[${ts()}] 📞 Initiating outbound call to ${customerPhone}`);
    console.log(`[${ts()}] 📣 Campaign: ${campaign.name}`);

    // Initiate call via ElevenLabs native Twilio integration
    const callResponse =
      await elevenLabsClient.conversationalAi.twilio.outboundCall({
        agentId: ELEVEN_LABS_AGENT_ID,
        agentPhoneNumberId: ELEVEN_LABS_AGENT_PHONE_NUMBER_ID,
        toNumber: customerPhone,
        conversationInitiationClientData: {
          dynamicVariables: {
            campaign_name: campaign.name,
            campaign_details: campaign.prompt,
            call_id: callId, // Pass callId as dynamic variable for webhook matching
          },
        },
      });

    console.log(`[${ts()}] 📥 ElevenLabs call response:`, callResponse);

    // Log full response to debug structure
    if (DEBUG_VERBOSE) {
      console.log(
        `[${ts()}] 📋 ElevenLabs response:`,
        JSON.stringify(callResponse, null, 2),
      );
    }

    // Extract conversation ID from response (try multiple possible structures)
    const conversationId =
      (callResponse as any)?.conversationId ||
      // (callResponse as any)?.id ||
      // (callResponse as any)?.data?.conversation_id ||
      // (callResponse as any)?.conversationId ||
      // (callResponse as any)?.result?.conversation_id ||
      null;

    // Twilio CallSid returned by ElevenLabs native integration (CA...)
    const twilioCallSid =
      (callResponse as any)?.callSid ||
      // (callResponse as any)?.call_sid ||
      // (callResponse as any)?.data?.callSid ||
      null;

    console.log(
      `[${ts()}] ✅ Call initiated, conversation ID: ${conversationId || "pending (will match by phone number)"}`,
    );

    // Store call data for tracking
    activeCalls.set(callId, {
      customerPhone,
      campaign,
      conversation: [],
      startedAt: new Date(),
      conversationId: conversationId || undefined,
      twilioCallSid: twilioCallSid || undefined,
    });

    await upsertCallState({
      callId,
      customerPhone,
      campaign,
      conversationId: conversationId || undefined,
      twilioCallSid: twilioCallSid || undefined,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Create call log in MongoDB
    try {
      await CallLog.create({
        callId,
        callSid: twilioCallSid,
        conversationId: conversationId,
        customerPhone,
        campaign: {
          name: campaign.name,
          prompt: campaign.prompt,
        },
        outcome: "in_progress",
        conversation: [],
        startedAt: new Date(),
      });
      console.log(`[${ts()}] 💾 Call log created in MongoDB`);
    } catch (dbError) {
      console.error(`[${ts()}] ⚠️ Failed to create call log:`, dbError);
    }

    // Polling fallback (NOT recommended at scale). Enable only when needed:
    // ENABLE_POLLING_FALLBACK=true
    // if (ENABLE_POLLING_FALLBACK && conversationId) {
    //   startConversationPolling();
    //   console.log(`[${ts()}] 🔄 Polling fallback enabled for ${conversationId}`);
    // }

    res.json({
      success: true,
      callId,
      conversationId,
      twilioCallSid,
      message: `Call initiated to ${customerPhone}`,
    });
  } catch (error) {
    console.error(`[${ts()}] ❌ Error initiating call:`, error);
    res.status(500).json({ error: `Failed to initiate call: ${error}` });
  }
}

export const elevenLabsPostCallWebhook = async (
  req: Request,
  res: Response,
) => {
  try {
    const payload = req.body || {};
    // Don't log full payload in production – it can be very large.
    if (DEBUG_VERBOSE) {
      console.log(
        `[${ts()}] 📥 ElevenLabs webhook received (type):`,
        payload?.type || "unknown",
      );
    }

    // Map ElevenLabs webhook payload structure: data is nested in payload.data
    const data = payload?.data || payload;
    const webhookType = payload?.type || "unknown";
    const conversationId =
      data?.conversation_id ||
      data?.conversationId ||
      payload?.conversation_id ||
      payload?.conversationId;
    const callIdFromVars =
      data?.conversation_initiation_client_data?.dynamic_variables?.call_id ||
      data?.conversation_initiation_client_data?.dynamicVariables?.call_id ||
      payload?.dynamic_variables?.call_id ||
      payload?.conversation_initiation_client_data?.dynamicVariables?.call_id;

    console.log(
      `[${ts()}] 📥 ElevenLabs webhook received: ${webhookType} for conversation: ${conversationId || "unknown"}`,
    );

    // Extract callId using same logic as real-time webhook
    let callId: string | null = callIdFromVars || null;
    if (!callId && conversationId) {
      callId = await getCallIdByConversationId(conversationId);
    }
    if (!callId) {
      console.log(
        `[${ts()}] ⚠️ No callId found for conversation: ${conversationId || "unknown"}`,
      );
      return res.sendStatus(200);
    }

    // Check if call is already finalized to avoid duplicate processing
    const existingLog = await CallLog.findOne({ callId }).exec();
    if (
      existingLog &&
      existingLog.outcome &&
      existingLog.outcome !== "in_progress" &&
      existingLog.endedAt
    ) {
      console.log(
        `[${ts()}] ⚠️ Call ${callId} already finalized with outcome: ${existingLog.outcome}. Skipping.`,
      );
      return res.sendStatus(200);
    }

    // Handle call_initiation_failure webhook
    if (webhookType === "call_initiation_failure") {
      const failureReason = data?.failure_reason || "unknown";
      let outcome = "no_answer";
      let summary = "Call failed to connect.";

      // Map failure reasons to outcomes
      switch (failureReason) {
        case "busy":
          outcome = "no_answer";
          summary = "Customer's phone was busy.";
          break;
        case "no-answer":
        case "no_answer":
          outcome = "no_answer";
          summary = "Customer did not answer the call.";
          break;
        case "failed":
        case "error":
          outcome = "no_answer";
          summary = `Call failed: ${failureReason}`;
          break;
        default:
          outcome = "no_answer";
          summary = `Call failed: ${failureReason}`;
      }

      console.log(
        `[${ts()}] 📞 Call initiation failed: ${failureReason} - marking as ${outcome}`,
      );

      await CallLog.findOneAndUpdate(
        { callId },
        {
          $set: {
            conversationId,
            outcome,
            summary,
            endedAt: new Date(),
            conversation: [], // Empty conversation for failed calls
            callDuration: 0,
          },
        },
      ).exec();

      console.log(
        `[${ts()}] 💾 Call failure finalized: ${outcome} - ${summary}`,
      );
      activeCalls.delete(callId);
      return res.sendStatus(200);
    }

    // Handle post_call_transcription webhook (normal call completion)
    // Extract and process transcript - map from data.transcript
    const transcript =
      data?.transcript ||
      data?.messages ||
      data?.conversation ||
      payload?.transcript ||
      payload?.messages ||
      payload?.conversation ||
      [];

    // Check call status to determine if call ended
    const callStatus = data?.status || payload?.status || "unknown";
    const isCallDone =
      callStatus === "done" ||
      callStatus === "ended" ||
      callStatus === "completed";

    // If transcript is empty, try to get existing conversation from DB
    let conversation: Array<{ role: "ai" | "customer"; message: string }> = [];
    let shouldFinalize = false;
    let finalOutcome: { outcome: string; summary: string } | null = null;

    if (Array.isArray(transcript) && transcript.length > 0) {
      // Process each message in transcript
      for (const m of transcript as any[]) {
        // Map roles: "agent" -> "ai", "user" -> "customer"
        const role =
          m.role === "agent" || m.role === "assistant" ? "ai" : "customer";
        const message = String(m.message || m.text || m.content || "").trim();

        if (message) {
          // Log in real-time
          if (role === "ai") {
            console.log(`[${ts()}] 💬 AI: "${message}"`);
          } else {
            console.log(`[${ts()}] 🎤 Customer: "${message}"`);
          }
          conversation.push({ role, message });
        }
      }

      // Store conversation in MongoDB (replace entire array to avoid duplicates)
      if (conversation.length > 0) {
        await CallLog.findOneAndUpdate(
          { callId },
          { $set: { conversation } },
          { upsert: false },
        ).exec();
        console.log(
          `[${ts()}] 💾 Stored ${conversation.length} messages in conversation`,
        );
        shouldFinalize = true;
      }
    } else {
      // If transcript is empty, check if we should finalize as "no_answer"
      if (isCallDone) {
        // Call ended but no transcript - likely not answered
        console.log(
          `[${ts()}] 📞 Call ended with status "${callStatus}" but no transcript - marking as no_answer`,
        );
        finalOutcome = {
          outcome: "no_answer",
          summary: "Customer did not respond during the call.",
        };
        shouldFinalize = true;
        conversation = []; // Empty conversation for no_answer
      } else if (
        existingLog &&
        existingLog.conversation &&
        Array.isArray(existingLog.conversation) &&
        existingLog.conversation.length > 0
      ) {
        // Use existing conversation from DB if available
        conversation = existingLog.conversation.map((c: any) => ({
          role:
            c.role === "ai" || c.role === "agent" || c.role === "assistant"
              ? "ai"
              : "customer",
          message: String(c.message || c.text || c.content || ""),
        }));
        console.log(
          `[${ts()}] 📋 Using existing conversation from DB (${conversation.length} messages)`,
        );
        shouldFinalize = true;
      } else {
        // No transcript, call not done, and no existing conversation - wait for more data
        console.log(
          `[${ts()}] ⚠️ No transcript provided, call status: ${callStatus}. Waiting for more data.`,
        );
        return res.sendStatus(200);
      }
    }

    // Determine outcome and finalize
    const result =
      finalOutcome ||
      (conversation.length > 0
        ? determineOutcome(conversation)
        : {
          outcome: "no_answer",
          summary: "Customer did not respond during the call.",
        });

    // Only finalize if we determined we should
    if (!shouldFinalize) {
      console.log(
        `[${ts()}] ⚠️ Skipping finalization - no valid data to process.`,
      );
      return res.sendStatus(200);
    }

    // Map call duration from data.metadata.call_duration_secs (post_call_transcription structure)
    const callDuration =
      data?.metadata?.call_duration_secs ||
      data?.metadata?.duration ||
      data?.call_duration_secs ||
      data?.duration ||
      payload?.data?.metadata?.call_duration_secs ||
      payload?.metadata?.call_duration_secs ||
      payload?.duration ||
      payload?.call_duration ||
      existingLog?.callDuration ||
      0;

    await CallLog.findOneAndUpdate(
      { callId },
      {
        $set: {
          conversationId,
          outcome: result.outcome,
          summary: result.summary,
          endedAt: new Date(),
          conversation, // Set the full conversation array (may be empty for no_answer)
          callDuration,
        },
      },
    ).exec();

    console.log(
      `[${ts()}] 💾 Post-call webhook finalized: ${result.outcome} - ${result.summary}`,
    );
    activeCalls.delete(callId);
    return res.sendStatus(200);
  } catch (err) {
    console.error(`[${ts()}] ❌ elevenLabsPostCallWebhook error:`, err);
    return res.sendStatus(200);
  }
};

export const callStatus = async (req: Request, res: Response) => {
  const callId = req.query.callId as string;
  const status = req.body.CallStatus;
  const duration = req.body.CallDuration;

  console.log(`[${ts()}] 📊 Call ${callId} status: ${status}`);

  // Update call log based on status
  if (
    status === "completed" ||
    status === "failed" ||
    status === "busy" ||
    status === "no-answer"
  ) {
    const callData = activeCalls.get(callId);

    try {
      // First, get the existing call log to check conversation
      const existingLog = await CallLog.findOne({ callId });

      // Use conversation from activeCalls if available, otherwise from DB
      const conversation =
        callData?.conversation || existingLog?.conversation || [];

      let outcome = "in_progress";
      let summary = "";

      if (status === "no-answer") {
        outcome = "no_answer";
        summary = "Customer did not answer the call.";
      } else if (status === "busy") {
        outcome = "busy";
        summary = "Customer's line was busy.";
      } else if (status === "failed") {
        outcome = "failed";
        summary = "Call failed to connect.";
      } else if (status === "completed") {
        // Determine outcome based on conversation
        if (conversation.length > 0) {
          // Convert to plain array for determineOutcome function
          const plainConversation = conversation.map((c: any) => ({
            role: c.role || "",
            message: c.message || "",
          }));
          const result = determineOutcome(plainConversation);
          outcome = result.outcome;
          summary = result.summary;
        } else {
          // No conversation recorded - call connected but no interaction
          outcome = "no_answer";
          summary = "Call connected but no conversation recorded.";
        }
      }

      // Only update if the current outcome is still in_progress or unknown
      // This prevents overwriting a properly determined outcome from WebSocket close
      const updateData: any = {
        twilioStatus: status,
        callDuration: parseInt(duration) || 0,
        endedAt: new Date(),
      };

      // Only update outcome if it wasn't already finalized
      if (!existingLog || existingLog.outcome === "in_progress") {
        updateData.outcome = outcome;
        updateData.summary = summary;
        if (conversation.length > 0) {
          updateData.conversation = conversation;
        }
      }

      // Update MongoDB
      await CallLog.findOneAndUpdate({ callId }, { $set: updateData });
      console.log(
        `[${ts()}] 💾 Call log updated: ${updateData.outcome || existingLog?.outcome || "N/A"}`,
      );
    } catch (dbError) {
      console.error(`[${ts()}] ⚠️  Failed to update call log:`, dbError);
    }

    // Clean up call data
    if (callId) {
      activeCalls.delete(callId);
      console.log(`[${ts()}] 🧹 Cleaned up call data for ${callId}`);
    }
  }

  res.sendStatus(200);
};

export const listActiveCalls = (req: Request, res: Response) => {
  const calls = Array.from(activeCalls.entries()).map(([id, data]) => ({
    callId: id,
    conversationId: data.conversationId,
    twilioCallSid: data.twilioCallSid,
    customerPhone: data.customerPhone,
    campaign: data.campaign.name,
    messageCount: data.conversation.length,
    startedAt: data.startedAt,
  }));
  res.json({ activeCalls: calls });
};

export const callLogs = async (req: Request, res: Response) => {
  try {
    const { outcome, phone, limit = 50, skip = 0 } = req.query;

    console.log(limit, skip);

    const query: any = {};
    if (outcome) {
      query.outcome = outcome;
    }
    if (phone) {
      // Support partial phone number matching
      query.customerPhone = { $regex: phone as string, $options: "i" };
    }

    const logs = await CallLog.find(query)
      .sort({ createdAt: -1 })
      .skip(Number(skip))
      .limit(Number(limit));

    const total = await CallLog.countDocuments(query);

    res.json({
      success: true,
      total,
      logs,
    });
  } catch (error) {
    console.error(`[${ts()}] ❌ Error fetching call logs:`, error);
    res.status(500).json({ error: "Failed to fetch call logs" });
  }
};

// stats

// ── Get call statistics ──
export const callStats = async (req: Request, res: Response) => {
  try {
    const stats = await CallLog.aggregate([
      {
        $group: {
          _id: "$outcome",
          count: { $sum: 1 },
        },
      },
    ]);

    const totalCalls = await CallLog.countDocuments();
    const avgDuration = await CallLog.aggregate([
      { $match: { callDuration: { $gt: 0 } } },
      { $group: { _id: null, avgDuration: { $avg: "$callDuration" } } },
    ]);

    const outcomeMap: Record<string, number> = {};
    stats.forEach((s: any) => {
      outcomeMap[s._id] = s.count;
    });

    res.json({
      success: true,
      totalCalls,
      outcomes: {
        interested: outcomeMap["interested"] || 0,
        not_interested: outcomeMap["not_interested"] || 0,
        no_answer: outcomeMap["no_answer"] || 0,
        busy: outcomeMap["busy"] || 0,
        failed: outcomeMap["failed"] || 0,
        in_progress: outcomeMap["in_progress"] || 0,
      },
      averageCallDuration: avgDuration[0]?.avgDuration || 0,
    });
  } catch (error) {
    console.error(`[${ts()}] ❌ Error fetching call stats:`, error);
    res.status(500).json({ error: "Failed to fetch call statistics" });
  }
};

// ── Get single call log by ID ──
export const callLogById = async (req: Request, res: Response) => {
  try {
    const { callId } = req.params;
    const log = await CallLog.findOne({ callId });

    if (!log) {
      return res.status(404).json({ error: "Call log not found" });
    }

    res.json({
      success: true,
      log,
    });
  } catch (error) {
    console.error(`[${ts()}] ❌ Error fetching call log:`, error);
    res.status(500).json({ error: "Failed to fetch call log" });
  }
};

// ── Get all calls for a specific phone number ──
export const callsByPhone = async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    const { limit = 50, skip = 0 } = req.query;

    // Normalize phone number (remove spaces, handle with/without +)
    const phoneRegex = phone.replace(/\s+/g, "").replace(/^\+/, "");

    const logs = await CallLog.find({
      customerPhone: { $regex: phoneRegex, $options: "i" },
    })
      .sort({ createdAt: -1 })
      .skip(Number(skip))
      .limit(Number(limit));

    const total = await CallLog.countDocuments({
      customerPhone: { $regex: phoneRegex, $options: "i" },
    });

    // Calculate stats for this customer
    const stats = await CallLog.aggregate([
      { $match: { customerPhone: { $regex: phoneRegex, $options: "i" } } },
      {
        $group: {
          _id: "$outcome",
          count: { $sum: 1 },
        },
      },
    ]);

    const outcomeMap: Record<string, number> = {};
    stats.forEach((s: any) => {
      outcomeMap[s._id] = s.count;
    });

    res.json({
      success: true,
      customerPhone: phone,
      totalCalls: total,
      outcomes: {
        interested: outcomeMap["interested"] || 0,
        not_interested: outcomeMap["not_interested"] || 0,
        no_answer: outcomeMap["no_answer"] || 0,
        busy: outcomeMap["busy"] || 0,
        failed: outcomeMap["failed"] || 0,
        in_progress: outcomeMap["in_progress"] || 0,
      },
      calls: logs,
    });
  } catch (error) {
    console.error(`[${ts()}] ❌ Error fetching customer calls:`, error);
    res.status(500).json({ error: "Failed to fetch customer calls" });
  }
};

// ── Get list of all customers with their call summary ──
export const customers = async (req: Request, res: Response) => {
  try {
    const { outcome, limit = 100, skip = 0, sort = "recent" } = req.query;

    // Aggregation to group by phone number
    const matchStage: any = {};
    if (outcome) {
      matchStage.outcome = outcome;
    }

    const sortStage: any =
      sort === "calls" ? { totalCalls: -1 } : { lastCallAt: -1 };

    const customers = await CallLog.aggregate([
      ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
      {
        $group: {
          _id: "$customerPhone",
          totalCalls: { $sum: 1 },
          lastCallAt: { $max: "$createdAt" },
          firstCallAt: { $min: "$createdAt" },
          outcomes: { $push: "$outcome" },
          lastOutcome: { $last: "$outcome" },
          lastCampaign: { $last: "$campaign.name" },
          totalDuration: { $sum: "$callDuration" },
        },
      },
      {
        $project: {
          _id: 0,
          customerPhone: "$_id",
          totalCalls: 1,
          lastCallAt: 1,
          firstCallAt: 1,
          lastOutcome: 1,
          lastCampaign: 1,
          totalDuration: 1,
          interestedCount: {
            $size: {
              $filter: {
                input: "$outcomes",
                cond: { $eq: ["$$this", "interested"] },
              },
            },
          },
          notInterestedCount: {
            $size: {
              $filter: {
                input: "$outcomes",
                cond: { $eq: ["$$this", "not_interested"] },
              },
            },
          },
          noAnswerCount: {
            $size: {
              $filter: {
                input: "$outcomes",
                cond: { $eq: ["$$this", "no_answer"] },
              },
            },
          },
        },
      },
      { $sort: sortStage },
      { $skip: Number(skip) },
      { $limit: Number(limit) },
    ]);

    // Get total unique customers count
    const totalCustomers = await CallLog.distinct("customerPhone").then(
      (phones) => phones.length,
    );

    res.json({
      success: true,
      total: totalCustomers,
      customers,
    });
  } catch (error) {
    console.error(`[${ts()}] ❌ Error fetching customers:`, error);
    res.status(500).json({ error: "Failed to fetch customers" });
  }
};

// ── Get customer statistics summary ──
export const customerStats = async (req: Request, res: Response) => {
  try {
    // Get unique customers count
    const totalCustomers = await CallLog.distinct("customerPhone").then(
      (phones) => phones.length,
    );

    // Get customers by their latest outcome
    const customersByOutcome = await CallLog.aggregate([
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$customerPhone",
          latestOutcome: { $first: "$outcome" },
        },
      },
      {
        $group: {
          _id: "$latestOutcome",
          count: { $sum: 1 },
        },
      },
    ]);

    const outcomeMap: Record<string, number> = {};
    customersByOutcome.forEach((c: any) => {
      outcomeMap[c._id] = c.count;
    });

    // Get customers with multiple calls
    const repeatCallers = await CallLog.aggregate([
      {
        $group: {
          _id: "$customerPhone",
          callCount: { $sum: 1 },
        },
      },
      { $match: { callCount: { $gt: 1 } } },
      { $count: "total" },
    ]);

    // Get conversion rate (interested / total unique customers)
    const interestedCustomers = await CallLog.aggregate([
      { $match: { outcome: "interested" } },
      { $group: { _id: "$customerPhone" } },
      { $count: "total" },
    ]);

    res.json({
      success: true,
      totalUniqueCustomers: totalCustomers,
      customersByLatestOutcome: {
        interested: outcomeMap["interested"] || 0,
        not_interested: outcomeMap["not_interested"] || 0,
        no_answer: outcomeMap["no_answer"] || 0,
        busy: outcomeMap["busy"] || 0,
        failed: outcomeMap["failed"] || 0,
        in_progress: outcomeMap["in_progress"] || 0,
      },
      repeatCallers: repeatCallers[0]?.total || 0,
      customersEverInterested: interestedCustomers[0]?.total || 0,
      conversionRate:
        totalCustomers > 0
          ? (
            ((interestedCustomers[0]?.total || 0) / totalCustomers) *
            100
          ).toFixed(2) + "%"
          : "0%",
    });
  } catch (error) {
    console.error(`[${ts()}] ❌ Error fetching customer stats:`, error);
    res.status(500).json({ error: "Failed to fetch customer statistics" });
  }
};
