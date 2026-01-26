// ───────────────── Env & Constants ─────────────────
export const PORT = parseInt(process.env.PORT || "5050", 10);
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
export const ELEVEN_LABS_API_KEY = process.env.ELEVEN_LABS_API_KEY || "";
export const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/marketing-calls";

// Twilio credentials for outbound calls
export const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
export const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
export const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || "";

// Public URL for Twilio webhooks (e.g., ngrok URL)
export const SERVER_URL = process.env.SERVER_URL || "";

export const REALTIME_MODEL = "gpt-realtime-2025-08-28";
export const ELEVEN_LABS_VOICE_ID =
  process.env.ELEVEN_LABS_VOICE_ID || "625jGFaa0zTLtQfxwc6Q"; // Rachel
export const DEBUG_VERBOSE = true;