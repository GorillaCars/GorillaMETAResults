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
- The app intentionally has no npm dependencies, so it can run anywhere Node 18+ is available.
