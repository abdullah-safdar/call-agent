import "dotenv/config";
import express from "express";
import ExpressWs from "express-ws";
import cors from "cors";
import {
  ELEVEN_LABS_API_KEY, ELEVEN_LABS_AGENT_ID,
  MONGODB_URI, PORT
} from "./constants";
import mongoose from "mongoose";
import routes from "./routes";



if (!ELEVEN_LABS_API_KEY) {
  console.error("❌ Missing ELEVEN_LABS_API_KEY in .env");
  process.exit(1);
}
if (!ELEVEN_LABS_AGENT_ID) {
  console.error("❌ Missing ELEVEN_LABS_AGENT_ID in .env");
  console.error("   Create an agent at https://elevenlabs.io/app/conversational-ai");
  console.error("   Configure with μ-law 8000 Hz for both input and output for Twilio compatibility");
  process.exit(1);
}
// if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
//   console.warn("⚠️  Missing Twilio credentials - outbound calls will not work");
// }
// if (!SERVER_URL) {
//   console.warn("⚠️  Missing SERVER_URL - set this to your public URL (e.g., ngrok URL)");
// }

// ───────────────── MongoDB Connection ─────────────────
async function connectToMongoDB() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to MongoDB");
    return true;
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    return false;
  }
}

// ───────────────── Setup ─────────────────


const { app: wsApp } = ExpressWs(express());
const app = wsApp;

// Middleware - MUST be before routes so req.body is populated
app.use(cors());
// Increase body size limit to handle large ElevenLabs post-call payloads
app.use(express.urlencoded({ extended: false, limit: "5mb" }));
app.use(express.json({ limit: "5mb" }));

// Routes
app.use(routes);




// ───────────────── Start Server ─────────────────
async function startServer() {
  console.log("🚀 Starting Marketing Call Agent...");
  console.log("");

  // Connect to MongoDB
  const mongoConnected = await connectToMongoDB();

  console.log("📋 Configuration:");
  console.log(`   - ElevenLabs API: ${ELEVEN_LABS_API_KEY ? "✅ Configured" : "❌ Missing"}`);
  console.log(`   - ElevenLabs Agent: ${ELEVEN_LABS_AGENT_ID ? "✅ Configured" : "❌ Missing"}`);
  // console.log(`   - Twilio: ${TWILIO_ACCOUNT_SID ? "✅ Configured" : "❌ Missing"}`);
  // console.log(`   - Server URL: ${SERVER_URL ? `✅ ${SERVER_URL}` : "❌ Missing (required for outbound calls)"}`);
  console.log(`   - MongoDB: ${mongoConnected ? "✅ Connected" : "❌ Not connected"}`);
  console.log("");

  // if (!SERVER_URL) {
  //   console.log("⚠️  To make outbound calls, you need a public URL.");
  //   console.log("   Run ngrok: ngrok http 5050");
  //   console.log("   Then set SERVER_URL in .env to your ngrok URL (e.g., https://abc123.ngrok.io)");
  //   console.log("");
  // }

  app.listen(PORT, () => {
    console.log(`🚀 Server started on port ${PORT}`);
    console.log(`Local:  http://localhost:${PORT}`);
    console.log("");
    console.log("📞 API Endpoints:");
    console.log(`   POST /call/initiate          - Initiate a marketing call (ElevenLabs SDK)`);
    console.log(`   GET  /calls/active           - List active calls`);
    console.log(`   GET  /calls/logs             - Get call logs (query: ?outcome=...&phone=...)`);
    console.log(`   GET  /calls/logs/:id         - Get single call log by ID`);
    console.log(`   GET  /calls/stats            - Get overall call statistics`);
    console.log("");
    console.log("🔗 Webhook Endpoints (configure in ElevenLabs):");
    console.log(`   POST /webhooks/elevenlabs           - Real-time call events`);
    console.log(`   POST /webhooks/elevenlabs/post-call - Post-call data`);
    console.log("");
    console.log("👤 Customer Endpoints:");
    console.log(`   GET  /customers              - List all customers with call summary (query: ?outcome=...&sort=recent|calls)`);
    console.log(`   GET  /customers/stats        - Get customer statistics (conversion rate, etc.)`);
    console.log(`   GET  /customers/:phone/calls - Get all calls for a specific phone number`);
    console.log("");
    console.log(`   GET  /health                 - Health check`);
    console.log("");
    console.log("📝 Example call initiation:");
    console.log(`   curl -X POST http://localhost:${PORT}/call/initiate \\`);
    console.log(`     -H "Content-Type: application/json" \\`);
    console.log(`     -d '{"customerPhone": "+1234567890", "campaign": {"name": "Pizza Palace", "prompt": "Promotion: 50% off all pizzas this weekend!\\nValid until: Sunday\\nSpecial items: Margherita, Pepperoni"}}'`);
    console.log("");
    // if (SERVER_URL) {
    //   console.log("⚙️  Configure webhooks in ElevenLabs Agent Settings → Events:");
    //   console.log(`   Events URL: ${SERVER_URL}/webhooks/elevenlabs`);
    //   console.log(`   Post-call URL: ${SERVER_URL}/webhooks/elevenlabs/post-call`);
    //   console.log("");
    // }
  });
}

startServer().catch(console.error);
