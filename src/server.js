import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import Database from "better-sqlite3";
import Stripe from "stripe";
import { Resend } from "resend";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
const db = new Database(process.env.DATABASE_PATH || "experiment.db");

db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    unsubscribe_token TEXT NOT NULL UNIQUE,
    consent_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stripe_session_id TEXT NOT NULL UNIQUE,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    payment_status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const stripeKey = process.env.STRIPE_SECRET_KEY || "";
// Intentionally test-mode only. Live keys are rejected by this starter.
const stripe = stripeKey.startsWith("sk_test_") ? new Stripe(stripeKey) : null;
const resend = process.env.RESEND_API_KEY?.startsWith("re_")
  ? new Resend(process.env.RESEND_API_KEY) : null;

const signupLimiter = rateLimit({ windowMs: 60 *  60 * 1000, limit: 5,
  standardHeaders: "draft-7", legacyHeaders: false });
const paymentLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10,
  standardHeaders: "draft-7", legacyHeaders: false });

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

// Stripe requires the raw body for signature verification. Do not put express.json()
// before this route.
app.post("/api/stripe-webhook", express.raw({ type: "application/json" }), (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.sendStatus(503);
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch {
    return res.status(400).send("Invalid webhook signature");
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    // Never record live-mode, unpaid, wrong-amount, or wrong-currency sessions.
    if (session.livemode === false && session.payment_status === "paid" &&
        session.amount_total === 100 && session.currency === "cad") {
      db.prepare(`INSERT OR IGNORE INTO payments
        (stripe_session_id, amount_cents, currency, payment_status)
        VALUES (?, ?, ?, ?)`).run(session.id, 100, "cad", "paid");
    }
  }
  res.json({ received: true });
});

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "../public")));

app.post("/api/subscribe", signupLimiter, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const consent = req.body?.consent === true;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    return res.status(400).json({ error: "Enter a valid email address." });
  if (!consent)
    return res.status(400).json({ error: "Please agree to receive email updates." });

  const token = crypto.randomBytes(32).toString("hex");
  try {
    db.prepare(`INSERT INTO subscribers (email, unsubscribe_token, consent_at)
      VALUES (?, ?, ?)`).run(email, token, new Date().toISOString());
  } catch (e) {
    if (String(e.code).includes("SQLITE_CONSTRAINT"))
      return res.status(409).json({ error: "That email is already subscribed." });
    console.error("Signup storage failed:", e.message);
    return res.status(500).json({ error: "Could not save signup." });
  }

  if (resend && process.env.EMAIL_FROM) {
    try {
      const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
      await resend.emails.send({
        from: process.env.EMAIL_FROM,
        to: email,
        subject: "Welcome to The $1 Experiment",
        text: `Thanks for joining The $1 Experiment. You can unsubscribe at any time: ${unsubscribeUrl}`
      });
    } catch (err) {
      console.error("Welcome email could not be sent:", err.message);
    }
  }
  res.status(201).json({ message: "You're on the list. Thanks for joining!" });
});

// A GET request only displays a confirmation page. Removal happens on POST,
// avoiding accidental unsubscribes caused by email link scanners.
app.get("/unsubscribe", (req, res) => {
  const token = String(req.query.token || "");
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).send("Invalid unsubscribe link.");
  res.type("html").send(`<!doctype html><html lang="en"><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Unsubscribe</title><body style="font-family:Arial;max-width:520px;margin:60px auto;padding:20px">
    <h1>Unsubscribe from updates?</h1><p>Confirm below to remove this email from the list.</p>
    <form method="post" action="/api/unsubscribe">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <button type="submit">Confirm unsubscribe</button>
    </form></body></html>`);
});

app.use("/api/unsubscribe", express.urlencoded({ extended: false }));
app.post("/api/unsubscribe", (req, res) => {
  const token = String(req.body?.token || "");
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).send("Invalid unsubscribe link.");
  const result = db.prepare("DELETE FROM subscribers WHERE unsubscribe_token = ?").run(token);
  res.status(result.changes ? 200 : 404).send(
    result.changes ? "You have been unsubscribed." : "This link is invalid or already used."
  );
});

app.post("/api/create-checkout-session", paymentLimiter, async (req, res) => {
  if (!stripe) return res.status(503).json({
    error: "Test payments are not configured. Live payments are intentionally disabled."
  });
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "cad",
          product_data: { name: "The $1 Experiment contribution" },
          unit_amount: 100
        },
        quantity: 1
      }],
      success_url: `${baseUrl}/?payment=success`,
      cancel_url: `${baseUrl}/?payment=cancelled`
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("Checkout creation failed:", err.message);
    res.status(500).json({ error: "Could not start checkout." });
  }
});

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN || "";
  const supplied = req.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (expected.length < 32) return res.sendStatus(503);
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(401);
  next();
}

app.get("/api/admin/stats", requireAdmin, (req, res) => {
  const subscribers = db.prepare("SELECT COUNT(*) AS count FROM subscribers").get().count;
  const paid = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(amount_cents),0) AS cents
    FROM payments WHERE payment_status = 'paid'`).get();
  res.json({ subscribers, contributions: paid.count, totalCad: (paid.cents / 100).toFixed(2) });
});

app.get("/api/admin/subscribers", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT email, consent_at, created_at FROM subscribers ORDER BY id DESC LIMIT 500").all();
  res.json({ subscribers: rows });
});

app.listen(port, () => console.log(`The $1 Experiment running at http://localhost:${port}`));
