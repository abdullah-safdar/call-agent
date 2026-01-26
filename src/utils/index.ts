// ───────────────── Utilities ─────────────────
export const ts = () =>
    new Date().toISOString().split("T")[1].replace("Z", "").slice(0, 12);
  
  