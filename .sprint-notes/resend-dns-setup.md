# Resend DNS setup for Signalera brief emails

This document covers the one-time setup required so that
`/api/brief/send-email` can dispatch the morning / evening brief as HTML email
from `briefs@signalera.com` (or whatever `EMAIL_FROM_ADDRESS` resolves to).

Until Noah completes these steps, the send-email endpoint will return `503
Email service not configured. Contact admin.` The PDF export continues to work
without Resend.

---

## 1. Sign up & add the sending domain

1. Create an account at <https://resend.com>.
2. In the Resend dashboard, go to **Domains** → **Add Domain**.
3. Enter the sending domain — e.g. `signalera.com` (the root, not the `briefs@`
   subdomain).
4. Resend will show a set of DNS records to copy into your DNS provider.

---

## 2. DNS records to add

Resend generates the exact values per domain. The shape is:

### SPF (TXT)

| Type | Host | Value                                     |
|------|------|-------------------------------------------|
| TXT  | `@`  | `v=spf1 include:_spf.resend.com ~all`     |

> If an SPF record already exists, **merge** the `include:_spf.resend.com`
> directive into the existing record instead of creating a second one.

### DKIM (3× CNAME)

Resend provides three CNAME records that look like this:

| Type  | Host                         | Value                                 |
|-------|------------------------------|---------------------------------------|
| CNAME | `resend._domainkey`          | `<key1>.dkim.resend.com`              |
| CNAME | `resend2._domainkey`         | `<key2>.dkim.resend.com`              |
| CNAME | `resend3._domainkey`         | `<key3>.dkim.resend.com`              |

Copy the exact host/value pairs from the Resend dashboard — do not hand-type
the suffixes.

### MX for bounces (optional but recommended)

| Type | Host  | Value             | Priority |
|------|-------|-------------------|----------|
| MX   | `send`| `mx.resend.com`   | 10       |

Handles bounces for the `send.signalera.com` subdomain Resend uses for reply
tracking. If your DNS provider asks for a single fully-qualified value, use
`mx.resend.com.` (trailing dot) with priority 10.

---

## 3. Verification & API key

1. In your DNS provider (Cloudflare, Route 53, Namecheap, etc.), add the
   records above. TTL 3600 is fine.
2. Back in the Resend dashboard, click **Verify DNS** on your domain page.
   Propagation is usually fast (<10 min) but can take up to 1 hour.
3. Once verified, open **API Keys** → **Create API Key** (Full Access).
4. Copy the key and paste it into `.env.local`:
   ```
   RESEND_API_KEY=re_xxxxxxxxxxxx...
   EMAIL_FROM_ADDRESS=briefs@signalera.com
   ```
5. Redeploy Vercel (or `vercel env add RESEND_API_KEY` + `EMAIL_FROM_ADDRESS`
   for production).

---

## 4. Smoke test

After setting env vars locally:

```
curl -X POST http://localhost:3000/api/brief/send-email \
  -H 'Content-Type: application/json' \
  --cookie "$(cat cookies.txt)" \
  -d '{"briefing_type":"morning","to":["you@example.com"]}'
```

Expected: `{"ok":true,"id":"..."}`. If you see `503`, the env var is not
loaded. If Resend returns `422 invalid_from` or `403 not_verified`, DNS
verification has not completed.

---

## 5. Production checklist

- [ ] Add `RESEND_API_KEY` to Vercel production + preview environments.
- [ ] Add `EMAIL_FROM_ADDRESS` to the same environments.
- [ ] Verify the sending domain is green in the Resend dashboard.
- [ ] Send one test brief to yourself via the UI.
- [ ] Confirm the email lands in the inbox (not spam). If spam-flagged,
      re-check SPF/DKIM and consider adding a DMARC record:
      `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:dmarc@signalera.com`.
