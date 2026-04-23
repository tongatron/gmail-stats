import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const ROOT = process.cwd();
const DEFAULT_CREDENTIALS_PATH = path.join(ROOT, "credentials.json");
const DEFAULT_TOKEN_PATH = path.join(ROOT, "token.json");
const DEFAULT_OUTPUT_PATH = path.join(ROOT, "sent_emails_all_years.json");
const DEFAULT_CHECKPOINT_PATH = path.join(ROOT, ".gmail_export_checkpoint.json");
const CONCURRENCY = 3;
const REQUEST_DELAY_MS = 150;
const MAX_RETRIES = 8;
const CHECKPOINT_EVERY = 25;

function parseArgs(argv) {
  const options = {
    credentials: DEFAULT_CREDENTIALS_PATH,
    token: DEFAULT_TOKEN_PATH,
    output: DEFAULT_OUTPUT_PATH,
    checkpoint: DEFAULT_CHECKPOINT_PATH,
    query: "in:sent",
    userId: "me"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--credentials" && next) {
      options.credentials = path.resolve(ROOT, next);
      index += 1;
      continue;
    }

    if (current === "--token" && next) {
      options.token = path.resolve(ROOT, next);
      index += 1;
      continue;
    }

    if (current === "--output" && next) {
      options.output = path.resolve(ROOT, next);
      index += 1;
      continue;
    }

    if (current === "--query" && next) {
      options.query = next;
      index += 1;
      continue;
    }

    if (current === "--checkpoint" && next) {
      options.checkpoint = path.resolve(ROOT, next);
      index += 1;
      continue;
    }

    if (current === "--user" && next) {
      options.userId = next;
      index += 1;
      continue;
    }

    if (current === "--help") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Usage:
  npm run export:sent -- [options]

Options:
  --credentials <path>   OAuth client credentials JSON. Default: ./credentials.json
  --token <path>         Saved OAuth token JSON. Default: ./token.json
  --output <path>        Output JSON path. Default: ./sent_emails_all_years.json
  --checkpoint <path>    Resume checkpoint JSON. Default: ./.gmail_export_checkpoint.json
  --query <gmail query>  Gmail search query. Default: "in:sent"
  --user <email|me>      Gmail user id. Default: me

Setup:
  1. Create a Google Cloud project and enable the Gmail API.
  2. Create an OAuth Desktop App client.
  3. Download the OAuth client JSON as ./credentials.json.
  4. Run this script and complete the browser sign-in once.
`);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getErrorText(error) {
  if (!error) {
    return "";
  }

  if (error.response?.data?.error?.message) {
    return String(error.response.data.error.message);
  }

  if (error.message) {
    return String(error.message);
  }

  return String(error);
}

function isRetryableError(error) {
  const status = error?.response?.status;
  const message = getErrorText(error).toLowerCase();

  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    message.includes("quota exceeded") ||
    message.includes("user-rate limit exceeded") ||
    message.includes("rate limit exceeded") ||
    message.includes("login required")
  );
}

async function withRetry(action, label) {
  let attempt = 0;

  while (true) {
    try {
      return await action();
    } catch (error) {
      attempt += 1;

      if (!isRetryableError(error) || attempt > MAX_RETRIES) {
        throw error;
      }

      const delayMs = Math.min(30000, 1000 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 250);
      console.log(`${label} hit a temporary Gmail limit. Retry ${attempt}/${MAX_RETRIES} in ${delayMs}ms.`);
      await sleep(delayMs);
    }
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }

  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content);
}

async function writeJson(filePath, payload) {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function loadSavedCredentialsIfExist(tokenPath, credentialsPath) {
  const tokenExists = await fileExists(tokenPath);
  const credentialsExists = await fileExists(credentialsPath);

  if (!tokenExists || !credentialsExists) {
    return null;
  }

  const tokenContent = await fs.readFile(tokenPath, "utf8");
  const credentialsContent = await fs.readFile(credentialsPath, "utf8");
  const token = JSON.parse(tokenContent);
  const credentials = JSON.parse(credentialsContent);
  const clientConfig = credentials.installed || credentials.web;

  if (!clientConfig) {
    throw new Error("credentials.json must contain an installed or web OAuth client.");
  }

  const oauth2Client = new google.auth.OAuth2(
    clientConfig.client_id,
    clientConfig.client_secret,
    clientConfig.redirect_uris?.[0]
  );

  oauth2Client.setCredentials(token);
  return oauth2Client;
}

async function saveCredentials(tokenPath, credentialsPath, authClient) {
  const credentialsContent = await fs.readFile(credentialsPath, "utf8");
  const credentials = JSON.parse(credentialsContent);
  const clientConfig = credentials.installed || credentials.web;

  if (!clientConfig) {
    throw new Error("credentials.json must contain an installed or web OAuth client.");
  }

  const tokenPayload = {
    type: "authorized_user",
    client_id: clientConfig.client_id,
    client_secret: clientConfig.client_secret,
    refresh_token: authClient.credentials.refresh_token,
    access_token: authClient.credentials.access_token,
    scope: authClient.credentials.scope,
    token_type: authClient.credentials.token_type,
    expiry_date: authClient.credentials.expiry_date
  };

  await fs.writeFile(tokenPath, JSON.stringify(tokenPayload, null, 2));
}

async function authorize(credentialsPath, tokenPath) {
  const existingClient = await loadSavedCredentialsIfExist(tokenPath, credentialsPath);
  if (existingClient) {
    return existingClient;
  }

  const authClient = await authenticate({
    scopes: SCOPES,
    keyfilePath: credentialsPath
  });

  if (authClient.credentials.refresh_token) {
    await saveCredentials(tokenPath, credentialsPath, authClient);
  }

  return authClient;
}

async function listAllMessageIds(gmail, userId, query) {
  const ids = [];
  let pageToken;

  do {
    const response = await withRetry(
      () => gmail.users.messages.list({
        userId,
        q: query,
        maxResults: 500,
        pageToken
      }),
      "Listing messages"
    );

    const pageIds = (response.data.messages || []).map((message) => message.id).filter(Boolean);
    ids.push(...pageIds);
    pageToken = response.data.nextPageToken || undefined;
    process.stdout.write(`Listed ${ids.length} message ids...\r`);
    await sleep(REQUEST_DELAY_MS);
  } while (pageToken);

  process.stdout.write("\n");
  return ids;
}

function extractAddresses(headerValue) {
  if (!headerValue) {
    return [];
  }

  const matches = String(headerValue).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig);
  if (!matches) {
    return [];
  }

  return [...new Set(matches.map((item) => item.toLowerCase()))];
}

async function fetchMessageRecord(gmail, userId, id) {
  const response = await withRetry(
    () => gmail.users.messages.get({
      userId,
      id,
      format: "metadata",
      metadataHeaders: ["To", "Date"]
    }),
    `Fetching message ${id}`
  );

  const headers = response.data.payload?.headers || [];
  const toHeader = headers.find((header) => header.name?.toLowerCase() === "to")?.value || "";
  const dateHeader = headers.find((header) => header.name?.toLowerCase() === "date")?.value || "";
  const recipients = extractAddresses(toHeader);

  let timestamp = null;

  if (response.data.internalDate) {
    const parsed = Number(response.data.internalDate);
    if (!Number.isNaN(parsed)) {
      timestamp = new Date(parsed).toISOString();
    }
  }

  if (!timestamp && dateHeader) {
    const parsed = new Date(dateHeader);
    if (!Number.isNaN(parsed.getTime())) {
      timestamp = parsed.toISOString();
    }
  }

  if (!timestamp) {
    throw new Error(`Unable to determine timestamp for message ${id}`);
  }

  return {
    date: timestamp,
    to: recipients
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

function uniqueSortedMessages(messages) {
  const unique = new Map();

  for (const message of messages) {
    const dedupeKey = `${message.date}|${message.to.join(",")}`;
    if (!unique.has(dedupeKey)) {
      unique.set(dedupeKey, message);
    }
  }

  return [...unique.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
}

async function loadCheckpoint(checkpointPath, expectedQuery) {
  const checkpoint = await readJsonIfExists(checkpointPath);
  if (!checkpoint) {
    return null;
  }

  if (checkpoint.query !== expectedQuery) {
    console.log(`Ignoring checkpoint because query changed: ${checkpoint.query} -> ${expectedQuery}`);
    return null;
  }

  return checkpoint;
}

async function saveCheckpoint(checkpointPath, payload) {
  await writeJson(checkpointPath, payload);
}

async function removeCheckpoint(checkpointPath) {
  if (await fileExists(checkpointPath)) {
    await fs.unlink(checkpointPath);
  }
}

async function buildExport(gmail, userId, query, checkpointPath) {
  const profile = await gmail.users.getProfile({ userId });
  const emailAddress = profile.data.emailAddress || userId;
  const checkpoint = await loadCheckpoint(checkpointPath, query);
  const messageIds = checkpoint?.messageIds || await listAllMessageIds(gmail, userId, query);

  if (!messageIds.length) {
    return {
      description: `Email inviate da ${emailAddress}`,
      period: {
        from: null,
        to: null
      },
      total_messages: 0,
      messages: []
    };
  }

  const records = checkpoint?.records || {};
  let completed = Object.keys(records).length;
  let startIndex = checkpoint?.nextIndex || 0;

  if (checkpoint) {
    console.log(`Resuming from checkpoint at message ${startIndex + 1}/${messageIds.length}.`);
  } else {
    await saveCheckpoint(checkpointPath, {
      query,
      userId,
      messageIds,
      nextIndex: 0,
      records: {}
    });
  }

  while (startIndex < messageIds.length) {
    const batchIds = messageIds.slice(startIndex, startIndex + CONCURRENCY);
    const batchRecords = await Promise.all(
      batchIds.map((id) => fetchMessageRecord(gmail, userId, id))
    );

    batchIds.forEach((id, index) => {
      records[id] = batchRecords[index];
    });

    completed += batchIds.length;
    startIndex += batchIds.length;

    if (completed % CHECKPOINT_EVERY === 0 || startIndex >= messageIds.length) {
      await saveCheckpoint(checkpointPath, {
        query,
        userId,
        messageIds,
        nextIndex: startIndex,
        records
      });
    }

    process.stdout.write(`Fetched ${completed}/${messageIds.length} messages...\r`);
    await sleep(REQUEST_DELAY_MS);
  }
  process.stdout.write("\n");

  const messages = Object.values(records);
  const normalized = uniqueSortedMessages(messages);

  await removeCheckpoint(checkpointPath);

  return {
    description: `Email inviate da ${emailAddress}`,
    period: {
      from: normalized[0]?.date || null,
      to: normalized[normalized.length - 1]?.date || null
    },
    total_messages: normalized.length,
    messages: normalized
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!(await fileExists(options.credentials))) {
    throw new Error(
      `Missing OAuth client file at ${options.credentials}. Download your Desktop App credentials as credentials.json first.`
    );
  }

  console.log(`Using credentials: ${options.credentials}`);
  console.log(`Token cache: ${options.token}`);
  console.log(`Output file: ${options.output}`);
  console.log(`Checkpoint file: ${options.checkpoint}`);
  console.log(`Gmail query: ${options.query}`);

  const auth = await authorize(options.credentials, options.token);
  const gmail = google.gmail({ version: "v1", auth });
  const exported = await buildExport(gmail, options.userId, options.query, options.checkpoint);

  await fs.writeFile(options.output, `${JSON.stringify(exported, null, 2)}\n`);

  console.log(`Export complete: ${options.output}`);
  console.log(`Messages written: ${exported.total_messages}`);
  console.log(`Range: ${exported.period.from || "-"} -> ${exported.period.to || "-"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
