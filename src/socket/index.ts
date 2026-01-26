import { marketingCallStream } from "../services/calls";
import express from "express";
import ExpressWs from "express-ws";

const { app: wsApp } = ExpressWs(express());
const app = wsApp;
// ───────────────── Marketing Call WebSocket Handler ─────────────────
app.ws("/call/marketing-stream", marketingCallStream);


export default app;