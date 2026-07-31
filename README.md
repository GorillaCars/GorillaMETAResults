# Gorilla Cars CRM

Vercel-ready CRM for Meta Ads leads flowing into the Gorilla Cars Google Sheet.

## What It Does

- Reads lead rows from the Google Sheet.
- Shows a compact CRM interface inspired by modern sales tools.
- Lets the finance team update `lead_status`.
- Can add optional CRM finance columns to the sheet:
  - `finance_status`
  - `priority`
  - `assigned_to`
  - `next_action`
  - `last_contacted`
  - `vehicle_match`
  - `finance_notes`
- Writes updates back to the exact Google Sheet row.
- Sends optional Meta Conversions API feedback when lead status reaches a mapped quality stage.
- Shows a PIN lock screen and asks the finance team to unlock again every 8 hours.
- Runs on Vercel with static frontend files and serverless API routes.

## Google Sheet

Spreadsheet:

`https://docs.google.com/spreadsheets/d/1hjE0DJ_HCLiFNbpVaqfdIx0m-lFI0zkKYV_ivX3BHZs/edit`

The visible spreadsheet title is `Gorilla Cars Leads META ADS Form`, but the worksheet tab returned by Google Sheets is `Sheet1`. The app uses `GOOGLE_SHEET_NAME=Sheet1` by default.

## Setup

1. Create a Google Cloud service account.
2. Enable the Google Sheets API for that Google Cloud project.
3. Create a JSON key for the service account.
4. Share the Google Sheet with the service account email using Editor access.
5. Add the environment variables below in Vercel.

## Environment Variables

```bash
GOOGLE_SHEET_ID=1hjE0DJ_HCLiFNbpVaqfdIx0m-lFI0zkKYV_ivX3BHZs
GOOGLE_SHEET_NAME=Sheet1
GOOGLE_SERVICE_ACCOUNT_JSON={"client_email":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"}
META_DATASET_ID=1024308829545683
META_ACCESS_TOKEN=...
META_GRAPH_VERSION=v25.0
```

You can also use these instead of the full JSON:

```bash
GOOGLE_CLIENT_EMAIL=...
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

## Vercel

Use the Vercel project `gorilla-meta-results`.

The frontend is served from `public/`. Google Sheet reads and writes are handled by:

```text
/api/config
/api/leads
/api/leads/[rowNumber]
/api/setup/columns
```

## CRM Lock

The browser PIN is `4890`. Once unlocked, the CRM stays open for 8 hours in that browser, then locks and clears the visible lead data until the PIN is entered again.

While locked, the unlock screen shows a count of leads with `CREATED` status and refreshes that count every 15 minutes.

## Meta Feedback

The app can send server-side lead quality signals to Meta through Conversions API when `lead_status` is saved.

Current mapping:

```text
IN PROGRESS   -> QualifiedLead
COMPLETE      -> ConvertedLead
NOT QUALIFIED -> DisqualifiedLead
```

The Google Sheet should include these audit columns:

```text
meta_feedback_status
meta_feedback_event
meta_feedback_sent_at
meta_feedback_error
```

If the columns are missing, the backend creates them before writing feedback results.

For testing in Events Manager, add:

```bash
META_TEST_EVENT_CODE=...
```

Remove `META_TEST_EVENT_CODE` after test events are confirmed.

## Local Run

```bash
cp .env.example .env
npm start
```

Open:

```text
http://localhost:5173
```

## Notes

- Credentials stay on the server. The browser never receives Google write credentials.
- The app will not add finance columns automatically. Use `Prepare CRM fields` once from the UI.
- Meta feedback is non-blocking. Lead saves still succeed if Meta is not configured or returns an error; the result is written to the feedback columns.
- The app intentionally has no npm dependencies, so it can run anywhere Node 18+ is available.
