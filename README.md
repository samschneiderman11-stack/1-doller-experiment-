# The $1 Experiment — website + API starter

Repository for @the1dollarexperiment.

## Included
- Public signup website
- Email signup API with explicit opt-in
- SQLite subscriber database
- Optional welcome email through Resend
- CAD $1 Stripe Checkout integration, intentionally TEST-MODE ONLY
- Stripe webhook signature verification and payment validation
- Token-protected admin stats and subscriber-list endpoints
- Draft privacy notice
- Rate limits on signup and checkout
- Safer unsubscribe confirmation (GET displays a page; POST removes the address)

## Important status
This is a starter project, not a hosted live service. No payment account, email account, hosting, domain, or live payment setup is included. Live Stripe keys are deliberately rejected by the code. Do not change this restriction without review and approval from an eligible adult account holder and the relevant payment provider.

The privacy notice is a draft and must be completed by the responsible project operator before public launch. Add a real contact method, service-provider details, retention period, and required legal disclosures.

## Run locally
1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set a unique random `ADMIN_TOKEN` of at least 32 characters.
5. Run `npm run dev`.
6. Open `http://localhost:3000`.

## Email setup
An eligible account owner can configure Resend, verify a sending domain, and set `RESEND_API_KEY` and `EMAIL_FROM`. Configure SPF, DKIM, and DMARC with the domain provider. Without these, signups are stored but no welcome email is sent. Review applicable anti-spam rules before sending campaigns.

## Stripe test setup
An eligible adult account holder should configure a Stripe test account and test-mode secret key beginning with `sk_test_`. Set `STRIPE_WEBHOOK_SECRET` and configure the webhook endpoint at `/api/stripe-webhook` for `checkout.session.completed`. Test successful, cancelled, unpaid, wrong-amount, duplicate, and invalid-signature cases. The webhook only records paid, non-live CAD $1 sessions.

## Admin API
Send the admin token as a Bearer token:
- `GET /api/admin/stats`
- `GET /api/admin/subscribers` (returns up to 500 opted-in addresses)

Example:
```bash
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" http://localhost:3000/api/admin/stats
```

## Before production
- Deploy behind HTTPS and configure a persistent database volume.
- Store all secrets in the hosting provider's secret manager; never commit `.env` or real keys.
- Add automated encrypted backups and test restoration.
- Restrict admin access further (for example, identity-aware access or VPN); rotate the admin token if exposed.
- Complete and review the privacy notice, retention/deletion process, and unsubscribe handling.
- Verify sender-domain authentication and test email delivery.
- Have an eligible adult account holder review payment-provider eligibility, fundraising, privacy, tax, consumer-protection, and other applicable requirements before any live payments.
- Do not scrape addresses, buy lists, or send unsolicited bulk email. Only contact people who knowingly opted in.

## Not included
This repository does not deploy itself, create provider accounts, configure domains, send emails during setup, or enable live payments. The SQLite setup is for a small demo; choose a managed database and backup plan for a public service.
