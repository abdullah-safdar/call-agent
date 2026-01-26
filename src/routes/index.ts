
import express from "express";
import {
    initiateCall, outboundConnect, callStatus, healthCheck,
    listActiveCalls, callLogs, callStats, callLogById,
    callsByPhone, customers, customerStats
} from "../services/calls";


const app = express();

// ── Endpoint to initiate outbound marketing call ──
app.post("/call/initiate", initiateCall);

// ── TwiML webhook for outbound call connection ──
app.post("/call/outbound-connect", outboundConnect);

// ── Call status webhook ──
app.post("/call/status", callStatus);


// ── Health check endpoint ──
app.get("/health", healthCheck);

// ── List active calls ──
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
