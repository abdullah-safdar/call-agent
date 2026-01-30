// ───────────────── Env & Constants ─────────────────
export const PORT = parseInt(process.env.PORT || "5050", 10);
export const ELEVEN_LABS_API_KEY = process.env.ELEVEN_LABS_API_KEY || "";
export const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/marketing-calls";

// Twilio credentials for outbound calls
export const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
export const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
export const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || "";

// Public URL for Twilio webhooks (e.g., ngrok URL)
export const SERVER_URL = process.env.SERVER_URL || "";


export const ELEVEN_LABS_AGENT_ID = process.env.ELEVEN_LABS_AGENT_ID || "";
export const ELEVEN_LABS_AGENT_PHONE_NUMBER_ID = process.env.ELEVEN_LABS_AGENT_PHONE_NUMBER_ID || "";

// Fallback polling (NOT recommended at scale)
export const ENABLE_POLLING_FALLBACK = (process.env.ENABLE_POLLING_FALLBACK || "").toLowerCase() === "true";

export const DEBUG_VERBOSE = true;