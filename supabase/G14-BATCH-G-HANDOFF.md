# Batch G — Test-Mode Checklist + Go-Live Steps

**Date:** 2026-05-26
**Owner:** Brock
**What's in this batch:**
1. **Annual subscription plan** with a monthly/annual toggle in the portal cart.
2. **Two-sided** — wait, no. **One-sided referral program** (2 months free to the *referrer* only) per spec.

Both pieces are wired end-to-end in code. **Nothing fires against real customers until you complete the Stripe + Supabase steps below.** Test in Stripe **test mode first**.

---

## 0) Quick rollback plan if anything goes sideways

The annual feature is gated on env vars. If you want to "turn off annual" without redeploying:
- Delete `STRIPE_WEBSITE_ANNUAL_PRICE_ID`, `STRIPE_MARKETING_ANNUAL_PRICE_ID`, `STRIPE_FINOPS_ANNUAL_PRICE_ID`, `STRIPE_BUNDLE_ALL_ANNUAL_PRICE_ID` from Netlify env vars.
- The toggle stays visible, but picking Annual + checkout returns a server error ("Missing Stripe price IDs…"). Customers can still pick Monthly and pay normally.

To stop firing referral rewards mid-incident without a deploy:
- In Supabase, run: `update profiles set referral_code = null where user_id = '<offending user_id>';` (clears their code so no further reward firings).
- Or rename the `referrals` table: `alter table referrals rename to referrals_paused;` — webhook calls will 404 and skip the reward step. Reverse with `rename to referrals;`.

---

## 1) Supabase — apply the schema migration

In Supabase SQL editor (production project), run **once**:

```bash
supabase/G4-referrals.sql
```

That file adds:
- `profiles.referral_code`, `referral_credits_earned`, `referral_credits_applied`
- `leads.referral_code`
- The new `referrals` table with RLS (referrer can read own; only service role writes)
- `checkout_states.billing` and `checkout_states.referral_code` columns
- A partial unique index that prevents the same email being credited twice across the platform

Every statement uses `if not exists`, so it's safe to re-run.

**Verification queries:**
```sql
select column_name from information_schema.columns where table_name = 'profiles' and column_name like 'referral%';
-- expect: referral_code, referral_credits_earned, referral_credits_applied

select column_name from information_schema.columns where table_name = 'leads' and column_name = 'referral_code';
-- expect: referral_code

select * from referrals limit 0;
-- expect: query returns no rows, no error (table exists)

select policyname from pg_policies where tablename = 'referrals';
-- expect: referrals_read_own
```

---

## 2) Stripe — create test-mode products + prices FIRST

Toggle Stripe dashboard to **Test mode** (top right). Create five products:

| Product name | Recurring? | Price | Suggested name in Stripe |
|---|---|---|---|
| Bedrock Website — Annual | Yes, yearly | $220.00 | "Website Annual" |
| Bedrock Marketing — Annual | Yes, yearly | $320.00 | "Marketing Annual" |
| Bedrock Finance & Operations — Annual | Yes, yearly | $750.00 | "FinOps Annual" |
| Bedrock Full Ecosystem — Annual | Yes, yearly | $1000.00 | "Bundle Annual" |

For each, copy the **price ID** (starts with `price_`).

If you'd rather repurpose `STRIPE_SUBSCRIPTION_PRICE_ID` for Website annual (since it was already set to something), point it at the new $220/yr Website Annual price.

---

## 3) Netlify — set the test-mode env vars

In Netlify → Site settings → Environment variables, **temporarily**:

1. Save the LIVE values somewhere safe first:
   - Copy the current values of `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and all the `STRIPE_*_PRICE_ID` vars into a note.

2. Replace them with test-mode equivalents:
   - `STRIPE_SECRET_KEY` → `sk_test_…` (your Stripe test secret key)
   - `STRIPE_WEBHOOK_SECRET` → test mode webhook secret (set up a webhook endpoint to `…/.netlify/functions/stripe-webhook` in Stripe test dashboard)
   - `STRIPE_WEBSITE_PRICE_ID` → your test-mode $20/mo Website price ID
   - `STRIPE_MARKETING_PRICE_ID` → test-mode $30/mo Marketing
   - `STRIPE_FINOPS_PRICE_ID` → test-mode $70/mo FinOps
   - `STRIPE_BUNDLE_ALL_PRICE_ID` → test-mode $100/mo bundle

3. Add the four new ANNUAL env vars (test-mode prices from step 2 above):
   - `STRIPE_WEBSITE_ANNUAL_PRICE_ID`
   - `STRIPE_MARKETING_ANNUAL_PRICE_ID`
   - `STRIPE_FINOPS_ANNUAL_PRICE_ID`
   - `STRIPE_BUNDLE_ALL_ANNUAL_PRICE_ID`

4. Set `RESEND_DRY_RUN=true` so test runs don't email real people.

5. Trigger a redeploy ("Deploys → Trigger deploy → Deploy site").

---

## 4) Test the annual flow

1. Open `bedrock-sites.com/portal.html#subs` in a fresh incognito window.
2. Sign in as a test contractor (use a test email like `you+test1@yourdomain.com`).
3. Verify the **Monthly | Annual** toggle is visible above the subscription grid.
4. Click **Annual**. Confirm:
   - Bedrock Website card shows `$220 /yr`
   - Marketing shows `$320 /yr`
   - FinOps shows `$750 /yr`
   - Full Ecosystem bundle shows `$1,000 /yr` with the updated "Save $200/yr vs. monthly billing" line
5. Add Website to cart, click checkout. You should land on Stripe Checkout showing `$220.00 / year`.
6. Pay with `4242 4242 4242 4242` / any future expiry / any CVV / any ZIP.
7. After redirect, in Supabase: `select * from subscriptions where user_id = '<test user id>' order by updated_at desc limit 5;` — should show a row with `tool='website'` and `status='active'`. ✓ Pass.
8. Repeat for the bundle (pick all three tools, switch to Annual, checkout). Stripe should show one line item at $1,000/yr.

If step 5 shows an error like "Missing Stripe price IDs: STRIPE_WEBSITE_ANNUAL_PRICE_ID", you forgot to set the env var. Set it and redeploy.

---

## 5) Test the referral flow (test-mode end-to-end)

This needs two test contractors. Use two different incognito windows.

**Setup:**
1. In Supabase, manually assign a referral code to test contractor A: `update profiles set referral_code = 'TESTONE99' where email = 'you+test1@yourdomain.com';`
2. Or just sign up test contractor A through the normal flow — the welcome email will show their generated code (note that `RESEND_DRY_RUN=true` skips the email but the code is still persisted in profiles).

**Referrer journey:**
- As contractor A, open `/portal.html`, go to Subscriptions tab.
- Confirm the "Refer a friend" card shows TESTONE99 (or whatever their code is), with the share URL `bedrock-sites.com/ref/TESTONE99`, and Invited/Joined/Credited all = 0.

**Referred journey:**
- Open `bedrock-sites.com/ref/TESTONE99` in a different incognito window.
- Verify you land on the homepage. Check DevTools → Application → Local Storage — `bedrock-referral-code` should equal `TESTONE99`.
- Go through signup as contractor B (different email, e.g. `you+test2@yourdomain.com`).
- After signup, in Supabase: `select * from referrals where referral_code = 'TESTONE99';` — should show one row with `status = 'pending'`, `referrer_user_id` = A's id, `referred_user_id` = B's id.

**Reward trigger:**
- As contractor B, go through portal → Subscriptions → pick any tool → checkout with `4242 4242 4242 4242`.
- After payment, give Stripe ~30s to fire the webhook.
- Check Supabase: `select status, credited_stripe_txn, credited_amount_cents from referrals where referral_code = 'TESTONE99';` — should now show `status = 'credited'`, a non-null `credited_stripe_txn`, and `credited_amount_cents = 4000`.
- In Stripe test dashboard: find contractor A's customer → Balance → should show a `-$40.00` line "Bedrock referral reward — code TESTONE99".
- Back in Supabase: `select referral_credits_earned from profiles where email = 'you+test1@yourdomain.com';` — should be `2`.

**Edge-case checks** (you can do these by editing rows in Supabase, no real payments needed):
- **Self-referral block:** try signing up contractor B with email matching contractor A's email. The referrals row shouldn't be created (check `select count(*) from referrals where referrer_user_id = '<A id>'` — still 1, not 2).
- **Double-credit block:** with `RESEND_DRY_RUN=true`, in Stripe test dashboard, re-fire the `checkout.session.completed` event for contractor B's session. The webhook should see `status='credited'` already and skip. Check `credited_amount_cents` is still 4000 (not 8000).
- **No referrer subscription:** if contractor A doesn't have a Stripe customer yet (i.e., no subscriptions row with `stripe_customer_id`), the webhook should park status='paid' and email you (NOTIFY_EMAIL) saying "manual credit needed".

---

## 6) Go live

Once all test-mode checks pass:

1. In Stripe dashboard, **toggle back to Live mode**.
2. Create the SAME four annual products + prices in Live mode (same dollar amounts).
3. In Netlify env vars:
   - Restore the LIVE values for `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and the existing four monthly `STRIPE_*_PRICE_ID` vars (from your saved note).
   - Update the four new `STRIPE_*_ANNUAL_PRICE_ID` vars to the LIVE annual price IDs.
4. **Set `RESEND_DRY_RUN=false`** (or remove the var) so real customer emails fire again.
5. Trigger a redeploy.
6. Do a single live smoke test: have one of your own contractors (or your own personal Stripe account) try the annual upgrade with a real card. Refund yourself afterward.

---

## 7) What's unverified at hand-off

Since I can only ship code, not click through your Stripe dashboard:

- Whether the four annual products exist in Stripe (test OR live).
- Whether the Netlify env vars are set correctly.
- Whether the Stripe webhook endpoint is registered for `checkout.session.completed` AND `customer.subscription.updated|deleted` events.
- Whether existing customers (if any) need their `stripe_customer_id` backfilled into `subscriptions` so referral rewards can apply.

All of these are 5–15 minute dashboard tasks, not code changes.

---

## 8) Open question I owe you the answer to

You confirmed in Batch G that the reward is **2 months free to the referrer only** (spec answer, not the brief's "1 month each"). The implementation matches that. If you change your mind later and want to also reward the referred contractor, the easiest path is:
- Add a Stripe coupon (e.g. `BEDROCK-WELCOME-1MO` = first month free).
- In `validate-referral-code.js`, if the code is valid, return that coupon ID.
- In `checkout()` in portal.html, if the response includes a coupon, pass it as a `discounts[0][coupon]` line item to Stripe Checkout.

That's a follow-up, not a blocker.
