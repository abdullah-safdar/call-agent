
import express from "express";
import {
    initiateCall, callStatus,
    listActiveCalls, callLogs, callStats, callLogById,
    callsByPhone, customers, customerStats,

    elevenLabsPostCallWebhook
} from "../services/calls";


const app = express();

// ── Endpoint to initiate outbound marketing call (ElevenLabs SDK) ──
app.post("/call/initiate", initiateCall);

// ── ElevenLabs Webhooks (production path) ──

app.post("/webhooks/elevenlabs/post-call", elevenLabsPostCallWebhook);


// ── Call status webhook (legacy - for initiateCallls) ──
app.post("/call/status", callStatus);



app.get("/calls/active", listActiveCalls);

// ── Get call logs from MongoDB ──
app.get("/calls/logs", callLogs);

// ── Get call statistics ──
app.get("/calls/stats", callStats);

// ── Get single call log by ID ──
app.get("/calls/logs/:callId", callLogById);


// ── Get all calls for a specific phone number ──
app.get("/customers/:phone/calls", callsByPhone);

app.get("/customers/:phone/calls", callsByPhone);
app.get("/customers", customers);
app.get("/customers/stats", customerStats);

// ── Get customer statistics summary ──
app.get("/customers/stats", customerStats);


export default app;
