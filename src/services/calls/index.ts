import { Request, Response } from "express";
import Twilio from "twilio";
import { MarketingCampaign } from "../../@types";
import { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, SERVER_URL, DEBUG_VERBOSE, ELEVEN_LABS_VOICE_ID, ELEVEN_LABS_API_KEY, REALTIME_MODEL, OPENAI_API_KEY } from "../../constants";
import { activeCalls } from "../../@types";
import CallLog from "../../schemas/calllog.schema";
import { ts } from "../../utils";
import { buildMarketingInstructions, determineOutcome } from "../prompt";
import mongoose from "mongoose";
import { WebSocket } from "ws";

// Initialize Twilio client
const twilioClient = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);


export const initiateCall = async (req: Request, res: Response) => {
  const { customerPhone, campaign } = req.body as {
    customerPhone: string;
    campaign: MarketingCampaign;
  };

  if (!customerPhone) {
    return res.status(400).json({ error: "customerPhone is required" });
  }

  if (!campaign || !campaign.name) {
    return res.status(400).json({
      error: "campaign with name is required",
    });
  }

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    return res.status(500).json({ error: "Twilio credentials not configured" });
  }

  if (!SERVER_URL) {
    return res.status(500).json({
      error: "SERVER_URL not configured. Set SERVER_URL to your public URL (e.g., ngrok URL like https://abc123.ngrok.io)"
    });
  }

  try {
    const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Store call data for when the call connects
    activeCalls.set(callId, {
      customerPhone,
      campaign,
      conversation: [],
      startedAt: new Date(),
    });

    console.log(`[${ts()}] 📞 Initiating outbound call to ${customerPhone}`);
    console.log(`[${ts()}] 📣 Campaign: ${campaign.name} `);
    console.log(`[${ts()}] 🌐 Using webhook URL: ${SERVER_URL}`);

    // Initiate the call via Twilio
    const call = await twilioClient.calls.create({
      to: customerPhone,
      from: TWILIO_PHONE_NUMBER,
      url: `${SERVER_URL}/call/outbound-connect?callId=${encodeURIComponent(callId)}`,
      statusCallback: `${SERVER_URL}/call/status?callId=${encodeURIComponent(callId)}`,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallbackMethod: "POST",
    });

    // Update with callSid
    const callData = activeCalls.get(callId);
    if (callData) {
      callData.callSid = call.sid;
    }

    // Create initial call log in MongoDB
    try {
      await CallLog.create({
        callId,
        callSid: call.sid,
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
      console.error(`[${ts()}] ⚠️  Failed to create call log:`, dbError);
    }

    console.log(`[${ts()}] ✅ Call initiated: ${call.sid}`);

    res.json({
      success: true,
      callSid: call.sid,
      callId,
      message: `Call initiated to ${customerPhone}`,
    });
  } catch (error) {
    console.error(`[${ts()}] ❌ Error initiating call:`, error);
    res.status(500).json({ error: `Failed to initiate call: ${error}` });
  }
};

export const outboundConnect = async (req: Request, res: Response) => {
  const callId = req.query.callId as string;

  console.log(`[${ts()}] 📞 Outbound call connected: ${callId}`);

  // Convert https:// to wss:// for WebSocket
  const wsUrl = SERVER_URL.replace(/^https?:\/\//, "wss://");

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}/call/marketing-stream?callId=${encodeURIComponent(callId)}">
      <Parameter name="noiseReduction" value="true" />
      <Parameter name="echoCancellation" value="true" />
      <Parameter name="autoGainControl" value="true" />
      <Parameter name="callId" value="${callId}" />
    </Stream>
  </Connect>
</Response>`;

  res.type("text/xml").send(twiml);
};

export const callStatus = async (req: Request, res: Response) => {
  const callId = req.query.callId as string;
  const status = req.body.CallStatus;
  const duration = req.body.CallDuration;

  console.log(`[${ts()}] 📊 Call ${callId} status: ${status}`);

  // Update call log based on status
  if (status === "completed" || status === "failed" || status === "busy" || status === "no-answer") {
    const callData = activeCalls.get(callId);

    try {
      // First, get the existing call log to check conversation
      const existingLog = await CallLog.findOne({ callId });

      // Use conversation from activeCalls if available, otherwise from DB
      const conversation = callData?.conversation || existingLog?.conversation || [];

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
      await CallLog.findOneAndUpdate(
        { callId },
        { $set: updateData }
      );
      console.log(`[${ts()}] 💾 Call log updated: ${updateData.outcome || existingLog?.outcome || 'N/A'}`);
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
}


export const healthCheck = async (req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "marketing-call-agent",
    twilioConfigured: !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER),
    mongoConnected: mongoose.connection.readyState === 1,
  });
}

export const listActiveCalls = (req: Request, res: Response) => {
  const calls = Array.from(activeCalls.entries()).map(([id, data]) => ({
    callId: id,
    customerPhone: data.customerPhone,
    campaign: data.campaign.name,
  }));
  res.json({ activeCalls: calls });
}

export const marketingCallStream = async (ws: WebSocket, req: Request) => {
  console.log(`[${ts()}] 🔁 Marketing call WebSocket established`);

  // ── Per-call state ──
  let streamSid: string | null = null;
  let latestMediaTimestamp = 0;
  let callId: string | null = null;
  let campaign: MarketingCampaign | null = null;

  // Response tracking
  let responseStartTimestampTwilio: number | null = null;
  const markQueue: string[] = [];
  let isSpeaking = false;
  let isProcessingResponse = false;

  // Text content tracking
  let currentTextPartId: string | null = null;
  let currentTextBuffer = "";

  // Helper to add conversation entry and save to MongoDB
  const addConversationEntry = async (role: "ai" | "customer", message: string) => {
    if (callId && message.trim()) {
      const entry = {
        role,
        message: message.trim(),
        timestamp: new Date(),
      };

      // Add to in-memory store
      const callData = activeCalls.get(callId);
      if (callData) {
        callData.conversation.push(entry);
      }

      // Also save to MongoDB incrementally (non-blocking)
      CallLog.findOneAndUpdate(
        { callId },
        { $push: { conversation: entry } }
      ).catch(err => console.error(`[${ts()}] ⚠️ Failed to save conversation entry:`, err));
    }
  };

  // Helper to finalize call in DB before cleanup
  const finalizeCallInDb = async (reason: string) => {
    if (!callId) return;

    const callData = activeCalls.get(callId);
    if (!callData) return;

    try {
      // Determine outcome based on conversation
      const result = determineOutcome(callData.conversation);

      await CallLog.findOneAndUpdate(
        { callId },
        {
          $set: {
            outcome: result.outcome,
            summary: result.summary + ` (${reason})`,
            endedAt: new Date(),
            conversation: callData.conversation, // Save final conversation
          }
        }
      );
      console.log(`[${ts()}] 💾 Call finalized in DB: ${result.outcome} (${reason})`);
    } catch (err) {
      console.error(`[${ts()}] ⚠️ Failed to finalize call in DB:`, err);
    }
  };

  const sendMarkToTwilio = () => {
    if (!streamSid) return;
    ws.send(
      JSON.stringify({
        event: "mark",
        streamSid,
        mark: { name: "responsePart" },
      })
    );
    markQueue.push("responsePart");
  };

  const clearTwilioBuffer = () => {
    if (!streamSid) return;
    ws.send(JSON.stringify({ event: "clear", streamSid }));
    if (DEBUG_VERBOSE) console.log(`[${ts()}] 🧹 Cleared Twilio buffer`);
  };

  // ── ElevenLabs WebSocket (μ-law 8k) ──
  let elevenLabsWs: WebSocket | null = null;

  function initElevenLabsWs() {
    const url =
      `wss://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_LABS_VOICE_ID}` +
      `/stream-input?model_id=eleven_multilingual_v2&output_format=ulaw_8000`;
    elevenLabsWs = new WebSocket(url);

    elevenLabsWs.on("open", () => {
      console.log(`[${ts()}] 🎙️  ElevenLabs WS OPEN`);
      setTimeout(() => {
        if (elevenLabsWs?.readyState === WebSocket.OPEN) {
          elevenLabsWs.send(
            JSON.stringify({
              text: " ",
              voice_settings: { stability: 0.5, similarity_boost: 0.8 },
              xi_api_key: ELEVEN_LABS_API_KEY,
            })
          );
        }
      }, 30);
    });

    elevenLabsWs.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.audio && streamSid) {
          if (!isSpeaking && responseStartTimestampTwilio == null) {
            responseStartTimestampTwilio = latestMediaTimestamp;
          }
          isSpeaking = true;

          ws.send(
            JSON.stringify({
              event: "media",
              streamSid,
              media: { payload: msg.audio },
            })
          );
          sendMarkToTwilio();
        }

        if (msg.isFinal) {
          isSpeaking = false;
          console.log(`[${ts()}] 🔊 ElevenLabs TTS complete`);
        }
      } catch {
        if (streamSid && data.length > 0) {
          if (!isSpeaking && responseStartTimestampTwilio == null) {
            responseStartTimestampTwilio = latestMediaTimestamp;
          }
          isSpeaking = true;

          ws.send(
            JSON.stringify({
              event: "media",
              streamSid,
              media: { payload: data.toString("base64") },
            })
          );
          sendMarkToTwilio();
        }
      }
    });

    elevenLabsWs.on("error", (err: Error) => {
      console.error(`[${ts()}] ❌ ElevenLabs WS error:`, err);
    });

    elevenLabsWs.on("close", () => {
      console.log(`[${ts()}] 🔕 ElevenLabs WS CLOSED - reconnecting...`);
      setTimeout(() => {
        if (streamSid) {
          initElevenLabsWs();
        }
      }, 100);
    });
  }

  initElevenLabsWs();

  let greetingSent = false;

  function speakWithElevenLabs(text: string, retries = 0) {
    if (!elevenLabsWs || elevenLabsWs.readyState !== WebSocket.OPEN) {
      if (retries > 10) {
        console.error(`[${ts()}] ❌ ElevenLabs failed to connect after retries`);
        return;
      }
      console.warn(`[${ts()}] ⚠️  ElevenLabs not ready, waiting... (retry ${retries})`);
      if (elevenLabsWs?.readyState === WebSocket.CLOSED) initElevenLabsWs();
      setTimeout(() => speakWithElevenLabs(text, retries + 1), 100);
      return;
    }

    console.log(
      `[${ts()}] 🗣️  TTS request: "${text.substring(0, 80)}${text.length > 80 ? "..." : ""}"`
    );

    try {
      elevenLabsWs.send(JSON.stringify({ text, try_trigger_generation: true }));
      setTimeout(() => {
        if (elevenLabsWs?.readyState === WebSocket.OPEN) {
          elevenLabsWs.send(JSON.stringify({ text: "" }));
        }
      }, 50);
    } catch (err) {
      console.error(`[${ts()}] ❌ Error sending to ElevenLabs:`, err);
    }
  }

  // ── OpenAI Realtime WS (initialized after we get campaign data) ──
  let openAiWs: WebSocket | null = null;
  let keepAliveInterval: NodeJS.Timeout | null = null;

  function initOpenAiSession() {
    if (!campaign) {
      console.error(`[${ts()}] ❌ Cannot init OpenAI session: no campaign data`);
      return;
    }

    openAiWs = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`,
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1",
        },
        handshakeTimeout: 10000,
      }
    );

    openAiWs.on("open", () => {
      console.log(`[${ts()}] 🔌 OpenAI Realtime WS OPEN`);

      keepAliveInterval = setInterval(() => {
        if (openAiWs?.readyState === WebSocket.OPEN) {
          try {
            openAiWs.ping();
          } catch (err) {
            console.error(`[${ts()}] Error sending keepalive:`, err);
          }
        }
      }, 30000);


      const instructions = buildMarketingInstructions(campaign!);
      openAiWs!.send(
        JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["text"],
            instructions,
            input_audio_format: "g711_ulaw",
            input_audio_transcription: { model: "whisper-1" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.8,
              prefix_padding_ms: 250,
              silence_duration_ms: 800,
            },
            tools: [
              {
                type: "function",
                name: "end_call",
                description:
                  "End the call. ONLY call this when customer says EXACTLY: 'goodbye', 'bye', 'not interested', 'no thanks', 'stop calling', 'I have to go', or 'hang up'. NEVER call this when customer says 'yes', 'sure', 'ok', 'thank you', 'thanks', 'interesting', or asks a question - those mean CONTINUE the conversation!",
                parameters: {
                  type: "object",
                  properties: {},
                },
              },
            ],
            tool_choice: "auto",
          },
        })
      );
      console.log(`[${ts()}] ⬆️  session.update sent (marketing agent)`);

      // Send initial greeting after a short delay
      setTimeout(() => {
        if (!greetingSent) {
          greetingSent = true;
          console.log(`[${ts()}] 👋 Triggering initial marketing greeting`);
          // Trigger response to get the AI to start the conversation
          if (openAiWs?.readyState === WebSocket.OPEN) {
            openAiWs.send(JSON.stringify({ type: "response.create" }));
          }
        }
      }, 500);
    });

    const handleCallerSpeechStarted = () => {
      if (DEBUG_VERBOSE) console.log(`[${ts()}] 🗣️  Customer spoke; barge-in`);

      if (isSpeaking && elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
        try {
          elevenLabsWs.send(JSON.stringify({ text: "" }));
        } catch (err) {
          console.error(`[${ts()}] Error interrupting TTS:`, err);
        }
        isSpeaking = false;
      }

      clearTwilioBuffer();

      if (isProcessingResponse && openAiWs?.readyState === WebSocket.OPEN) {
        try {
          openAiWs.send(JSON.stringify({ type: "response.cancel" }));
          isProcessingResponse = false;
          if (DEBUG_VERBOSE) console.log(`[${ts()}] 🚫 Cancelled active response`);
        } catch (err) {
          console.error(`[${ts()}] Error cancelling response:`, err);
        }
      }

      markQueue.length = 0;
      responseStartTimestampTwilio = null;
    };

    openAiWs.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());

        if (
          DEBUG_VERBOSE &&
          ![
            "response.text.delta",
            "response.text.done",
            "response.content_part.added",
            "response.content_part.delta",
            "response.content_part.done",
          ].includes(msg.type)
        ) {
          console.log(`[${ts()}] ⇣ OpenAI event: ${msg.type}`);
        }

        if (msg.type === "input_audio_buffer.speech_started") {
          handleCallerSpeechStarted();
        }

        if (msg.type === "input_audio_buffer.speech_stopped") {
          if (!isProcessingResponse) {
            if (DEBUG_VERBOSE) console.log(`[${ts()}] 🎤 Customer stopped; creating response`);
            isProcessingResponse = true;
            setTimeout(() => {
              if (openAiWs?.readyState === WebSocket.OPEN) {
                openAiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
                openAiWs.send(JSON.stringify({ type: "response.create" }));
              }
            }, 10);
          }
        }

        if (msg.type === "response.content_part.added") {
          const part = msg.part || msg.content_part || msg.content?.part || null;
          const partType = part?.type || msg.part_type;
          if (partType === "output_text" || partType === "text") {
            currentTextPartId = msg.part_id || part?.id || null;
            currentTextBuffer = "";
            const initial = part?.text || msg.text || "";
            if (initial) currentTextBuffer += initial;
            if (DEBUG_VERBOSE)
              console.log(`[${ts()}] 🧩 text part started: ${currentTextPartId}`);
          }
        }

        if (msg.type === "response.content_part.delta") {
          const partId = msg.part_id || msg.part?.id || null;
          if (partId && partId === currentTextPartId) {
            const delta = msg.delta || msg.text || "";
            if (delta) currentTextBuffer += delta;
          }
        }

        if (msg.type === "response.content_part.done") {
          const partId = msg.part_id || msg.part?.id || null;
          if (partId && partId === currentTextPartId) {
            const rawText = currentTextBuffer.trim();
            currentTextPartId = null;
            currentTextBuffer = "";

            if (rawText) {
              console.log(`[${ts()}] 💬 AI: "${rawText}"`);
              addConversationEntry("ai", rawText);
              speakWithElevenLabs(rawText);
            }
          }
        }

        // Legacy fallback
        if (msg.type === "response.text.delta" && msg.delta) {
          currentTextBuffer += msg.delta;
        }
        if (msg.type === "response.text.done") {
          const rawText =
            (msg?.output_text && String(msg.output_text)) || currentTextBuffer.trim();
          currentTextBuffer = "";

          if (rawText) {
            console.log(`[${ts()}] 💬 AI: "${rawText}"`);
            addConversationEntry("ai", rawText);
            speakWithElevenLabs(rawText);
          }
        }

        // Transcripts - Track customer responses
        if (msg.type === "conversation.item.input_audio_transcription.completed") {
          const transcript = msg.transcript || "";
          console.log(`[${ts()}] 🎤 Customer said: "${transcript}"`);
          if (transcript.trim()) {
            addConversationEntry("customer", transcript);
          }
        }

        // Function calls
        if (msg.type === "response.function_call_arguments.done") {
          const functionName = msg.name;
          const callIdFunc = msg.call_id;

          console.log(`[${ts()}] 🔧 Function call: ${functionName}`);

          if (functionName === "end_call") {
            // Send function result back to OpenAI (required)
            if (openAiWs?.readyState === WebSocket.OPEN) {
              openAiWs.send(
                JSON.stringify({
                  type: "conversation.item.create",
                  item: {
                    type: "function_call_output",
                    call_id: callIdFunc,
                    output: JSON.stringify({ success: true }),
                  },
                })
              );
            }

            // Speak goodbye directly instead of asking AI to generate one
            const goodbyeMsg = "Thank you for your time! Have a great day. Goodbye!";
            addConversationEntry("ai", goodbyeMsg);
            speakWithElevenLabs(goodbyeMsg);

            // End the call after the goodbye message plays
            setTimeout(() => {
              console.log(`[${ts()}] 📞 Ending marketing call`);
              if (openAiWs?.readyState === WebSocket.OPEN) openAiWs.close();
              if (elevenLabsWs?.readyState === WebSocket.OPEN) elevenLabsWs.close();
              if (ws.readyState === WebSocket.OPEN) ws.close();
              if (callId) activeCalls.delete(callId);
            }, 4000);
          }
        }

        if (msg.type === "response.done") {
          if (DEBUG_VERBOSE) console.log(`[${ts()}] ✅ Response complete`);
          isProcessingResponse = false;
        }

        if (msg.type === "response.cancelled") {
          if (DEBUG_VERBOSE) console.log(`[${ts()}] 🚫 Response cancelled`);
          isProcessingResponse = false;
        }

        if (msg.type === "error") {
          const code = msg.error?.code;
          if (
            code === "input_audio_buffer_commit_empty" ||
            code === "conversation_already_has_active_response"
          ) {
            if (DEBUG_VERBOSE) console.log(`[${ts()}] ⚠️ Expected error: ${code}`);
          } else {
            console.error(`[${ts()}] ❌ OpenAI error:`, msg);
          }
        }
      } catch (err) {
        console.error(`[${ts()}] Error parsing OpenAI message:`, err);
      }
    });

    openAiWs.on("close", () => {
      console.log(`[${ts()}] 🔕 OpenAI WS CLOSED`);
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
    });

    openAiWs.on("error", (error: Error) => {
      console.error(`[${ts()}] ❌ OpenAI WS error:`, error);
    });
  }

  // ── Twilio → OpenAI ──
  ws.on("message", async (raw: string) => {
    const msg = JSON.parse(raw.toString());

    if (msg.event === "start" && msg.start) {
      streamSid = msg.start.streamSid;
      console.log(`[${ts()}] ▶️  Twilio START: streamSid=${streamSid}`);

      // Extract callId from custom parameters
      if (msg.start.customParameters?.callId) {
        callId = msg.start.customParameters.callId as string;
        console.log(`[${ts()}] 📞 Call ID: ${callId}`);

        const callData = activeCalls.get(callId!);
        if (callData) {
          campaign = callData.campaign;
          console.log(`[${ts()}] 📣 Campaign loaded: ${campaign.name}`);

          // Now initialize OpenAI with the campaign
          initOpenAiSession();
        } else {
          console.error(`[${ts()}] ❌ No call data found for ${callId}`);
          ws.close();
          return;
        }
      } else {
        console.error(`[${ts()}] ❌ No callId in custom parameters`);
        ws.close();
        return;
      }

      latestMediaTimestamp = 0;
      responseStartTimestampTwilio = null;
      markQueue.length = 0;
      return;
    }

    if (msg.event === "media" && msg.media?.payload) {
      latestMediaTimestamp = msg.media.timestamp;

      if (openAiWs?.readyState === WebSocket.OPEN) {
        openAiWs.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: msg.media.payload,
          })
        );
      }
      return;
    }

    if (msg.event === "mark") {
      if (markQueue.length > 0) markQueue.shift();
      return;
    }

    if (msg.event === "stop") {
      console.log(`[${ts()}] ⏹️  Twilio STOP`);
      if (openAiWs?.readyState === WebSocket.OPEN) openAiWs.close();
      if (elevenLabsWs?.readyState === WebSocket.OPEN) elevenLabsWs.close();
      // Don't delete activeCalls here - let status webhook handle it
      return;
    }
  });

  ws.on("close", async () => {
    console.log(`[${ts()}] 🔚 Twilio WS CLOSED`);

    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }

    if (openAiWs?.readyState === WebSocket.OPEN) openAiWs.close();
    if (elevenLabsWs?.readyState === WebSocket.OPEN) elevenLabsWs.close();

    // Save call data to DB before cleanup (handles sudden disconnects)
    if (callId) {
      await finalizeCallInDb("WebSocket closed");
      // Don't delete activeCalls here - let status webhook handle cleanup
      // This ensures status webhook can still access the data if it hasn't run yet
    }

    streamSid = null;
  });
}

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
}


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
      customerPhone: { $regex: phoneRegex, $options: "i" }
    })
      .sort({ createdAt: -1 })
      .skip(Number(skip))
      .limit(Number(limit));

    const total = await CallLog.countDocuments({
      customerPhone: { $regex: phoneRegex, $options: "i" }
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

    const sortStage: any = sort === "calls"
      ? { totalCalls: -1 }
      : { lastCallAt: -1 };

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
                cond: { $eq: ["$$this", "interested"] }
              }
            }
          },
          notInterestedCount: {
            $size: {
              $filter: {
                input: "$outcomes",
                cond: { $eq: ["$$this", "not_interested"] }
              }
            }
          },
          noAnswerCount: {
            $size: {
              $filter: {
                input: "$outcomes",
                cond: { $eq: ["$$this", "no_answer"] }
              }
            }
          },
        },
      },
      { $sort: sortStage },
      { $skip: Number(skip) },
      { $limit: Number(limit) },
    ]);

    // Get total unique customers count
    const totalCustomers = await CallLog.distinct("customerPhone").then(phones => phones.length);

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
    const totalCustomers = await CallLog.distinct("customerPhone").then(phones => phones.length);

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
      conversionRate: totalCustomers > 0
        ? ((interestedCustomers[0]?.total || 0) / totalCustomers * 100).toFixed(2) + "%"
        : "0%",
    });
  } catch (error) {
    console.error(`[${ts()}] ❌ Error fetching customer stats:`, error);
    res.status(500).json({ error: "Failed to fetch customer statistics" });
  }
};