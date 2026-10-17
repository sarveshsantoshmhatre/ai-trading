import { createHmac, timingSafeEqual } from "node:crypto";
import express from "express";
import { PrismaClient } from "./generated/prisma/client";
import cors from "cors";

const prisma = new PrismaClient();
const app = express();
app.use(express.json({ limit: "10kb" }));

const allowedOrigins = (process.env.DASHBOARD_ALLOWED_ORIGINS ?? "http://localhost:5173")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins, credentials: true }));

const SESSION_COOKIE = "dashboard_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function authConfigurationAvailable() {
  return Boolean(
    process.env.DASHBOARD_PASSWORD &&
    (process.env.DASHBOARD_SESSION_SECRET?.length ?? 0) >= 32,
  );
}

function signExpiry(expiry: string) {
  return createHmac("sha256", process.env.DASHBOARD_SESSION_SECRET!)
    .update(expiry).digest("base64url");
}

function validSession(req: express.Request) {
  if (!authConfigurationAvailable()) return false;
  const cookieHeader = req.headers.cookie ?? "";
  const rawCookie = cookieHeader.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(SESSION_COOKIE + "="));
  if (!rawCookie) return false;
  let token: string;
  try {
    token = decodeURIComponent(rawCookie.slice(SESSION_COOKIE.length + 1));
  } catch {
    return false;
  }
  const separator = token.indexOf(".");
  if (separator < 1) return false;
  const expiry = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!/^\d+$/.test(expiry) || Number(expiry) <= Date.now()) return false;
  const expected = Buffer.from(signExpiry(expiry));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!authConfigurationAvailable()) {
    res.status(503).json({ error: "Dashboard authentication is not configured" });
    return;
  }
  if (!validSession(req)) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

let loginAttempts = new Map<string, { count: number; resetAt: number }>();
app.post("/auth/login", (req, res) => {
  if (!authConfigurationAvailable()) {
    res.status(503).json({ error: "Set DASHBOARD_PASSWORD and a DASHBOARD_SESSION_SECRET of at least 32 characters" });
    return;
  }
  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const attempts = loginAttempts.get(ip);
  if (attempts && attempts.resetAt > now && attempts.count >= 10) {
    res.status(429).json({ error: "Too many login attempts. Try again later." });
    return;
  }
  const nextAttempts = !attempts || attempts.resetAt <= now
    ? { count: 1, resetAt: now + 15 * 60_000 }
    : { count: attempts.count + 1, resetAt: attempts.resetAt };
  loginAttempts.set(ip, nextAttempts);

  const configured = Buffer.from(process.env.DASHBOARD_PASSWORD!);
  const supplied = Buffer.from(typeof req.body?.password === "string" ? req.body.password : "");
  const matches = configured.length === supplied.length && timingSafeEqual(configured, supplied);
  if (!matches) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }

  loginAttempts.delete(ip);
  const expiry = String(now + SESSION_TTL_MS);
  const token = expiry + "." + signExpiry(expiry);
  const secure = process.env.NODE_ENV === "production";
  const sameSite = secure ? "None" : "Lax";
  res.setHeader("Set-Cookie",
    SESSION_COOKIE + "=" + encodeURIComponent(token) +
    "; HttpOnly; Path=/; Max-Age=" + String(SESSION_TTL_MS / 1000) +
    "; SameSite=" + sameSite + (secure ? "; Secure" : ""));
  res.json({ authenticated: true });
});

app.post("/auth/logout", (req, res) => {
  res.setHeader("Set-Cookie", SESSION_COOKIE + "=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax" +
    (process.env.NODE_ENV === "production" ? "; Secure" : ""));
  res.json({ authenticated: false });
});

app.get("/auth/me", requireAuth, (_req, res) => res.json({ authenticated: true }));

// A database-backed health check for the hosted service's health probe.
app.get("/healthz", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});

app.get("/models", requireAuth, async (_req, res) => {
  try {
    const models = await prisma.models.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, openRoutermodelName: true, invocationCount: true },
    });
    res.json({ data: models });
  } catch (error) {
    console.error("Error loading models:", error);
    res.status(500).json({ error: "Unable to load models" });
  }
});

app.post("/models", requireAuth, async (req, res) => {
  if ((process.env.TRADING_MODE ?? "paper") !== "paper") {
    res.status(403).json({ error: "Model onboarding is restricted to paper mode" });
    return;
  }
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const openRoutermodelName = typeof req.body?.openRoutermodelName === "string"
    ? req.body.openRoutermodelName.trim() : "";
  if (name.length < 1 || name.length > 80) {
    res.status(400).json({ error: "Display name must contain 1 to 80 characters" });
    return;
  }
  if (openRoutermodelName.length < 1 || openRoutermodelName.length > 160 ||
      !/^[a-zA-Z0-9._/-]+$/.test(openRoutermodelName)) {
    res.status(400).json({ error: "Enter a valid OpenRouter model identifier" });
    return;
  }
  try {
    const model = await prisma.models.create({
      data: {
        name,
        openRoutermodelName,
        // Non-secret sentinel. Paper mode never reads this field and the encrypted-key
        // requirement intentionally prevents this record from working in live mode.
        lighterApiKey: "PAPER_MODE_NO_CREDENTIALS",
        accountIndex: "paper",
      },
      select: { id: true, name: true, openRoutermodelName: true, invocationCount: true },
    });
    res.status(201).json({ data: model });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      res.status(409).json({ error: "A model with that display name already exists" });
      return;
    }
    console.error("Error creating paper model:", error);
    res.status(500).json({ error: "Unable to create paper model" });
  }
});

app.get("/performance", requireAuth, async (_req, res) => {
  try {
    const sinceParam = Number(_req.query.since);
    const since = Number.isFinite(sinceParam) && sinceParam > 0
      ? new Date(sinceParam) : new Date(Date.now() - 30 * 24 * 60 * 60_000);
    const data = await prisma.portfolioSize.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      include: { model: { select: { name: true } } },
      take: 25_000,
    });
    res.json({ data, lastUpdated: new Date() });
  } catch (error) {
    console.error("Error loading performance data:", error);
    res.status(500).json({ error: "Unable to load performance data" });
  }
});

app.get("/invocations", requireAuth, async (req, res) => {
  const limitParam = Number(req.query.limit);
  const take = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 200 ? limitParam : 30;
  try {
    const invocations = await prisma.invocations.findMany({
      orderBy: { createdAt: "desc" },
      take,
      include: {
        model: { select: { name: true } },
        toolCalls: {
          select: { toolCallType: true, metadata: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    res.json({ data: invocations, lastUpdated: new Date() });
  } catch (error) {
    console.error("Error loading invocations:", error);
    res.status(500).json({ error: "Unable to load invocations" });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log("Dashboard API listening on port " + port));
