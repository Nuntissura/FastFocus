import pg from "pg";

const { Client } = pg;

function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) ? n : fallback;
}

function parseArgs(argv) {
  const out = { confirm: false, batchSize: 2000, maxBatches: 10_000 };
  for (const arg of argv) {
    if (arg === "--confirm") out.confirm = true;
    if (arg.startsWith("--batch-size=")) out.batchSize = envIntFromArg(arg, "--batch-size=", out.batchSize);
    if (arg.startsWith("--max-batches=")) out.maxBatches = envIntFromArg(arg, "--max-batches=", out.maxBatches);
    if (arg.startsWith("--events-days=")) out.eventsDays = envIntFromArg(arg, "--events-days=", null);
    if (arg.startsWith("--http-request-logs-days=")) out.httpRequestLogsDays = envIntFromArg(arg, "--http-request-logs-days=", null);
    if (arg.startsWith("--ingestion-runs-days=")) out.ingestionRunsDays = envIntFromArg(arg, "--ingestion-runs-days=", null);
    if (arg.startsWith("--audit-log-days=")) out.auditLogDays = envIntFromArg(arg, "--audit-log-days=", null);
  }
  return out;
}

function envIntFromArg(arg, prefix, fallback) {
  const raw = arg.slice(prefix.length);
  const n = Number(raw);
  return Number.isInteger(n) ? n : fallback;
}

function cutoffIso({ days }) {
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

async function countOlderThan(client, { table, tsColumn, cutoff }) {
  const res = await client.query(`SELECT COUNT(*)::bigint AS c FROM ${table} WHERE ${tsColumn} < $1`, [cutoff]);
  const row = res.rows[0];
  return row ? Number(row.c) : 0;
}

async function deleteOlderThanInBatches(client, { table, idColumn, tsColumn, cutoff, batchSize, maxBatches }) {
  let deleted = 0;

  for (let i = 0; i < maxBatches; i += 1) {
    const res = await client.query(
      `
      WITH doomed AS (
        SELECT ${idColumn}
        FROM ${table}
        WHERE ${tsColumn} < $1
        ORDER BY ${tsColumn} ASC
        LIMIT $2
      )
      DELETE FROM ${table} t
      USING doomed d
      WHERE t.${idColumn} = d.${idColumn}
      RETURNING t.${idColumn}
      `,
      [cutoff, batchSize],
    );

    const batch = res.rowCount || 0;
    deleted += batch;
    if (batch === 0) break;
  }

  return deleted;
}

async function deleteWhereInBatches(client, { table, idColumn, whereSql, params, orderBySql, batchSize, maxBatches }) {
  let deleted = 0;

  for (let i = 0; i < maxBatches; i += 1) {
    const res = await client.query(
      `
      WITH doomed AS (
        SELECT ${idColumn}
        FROM ${table}
        WHERE ${whereSql}
        ORDER BY ${orderBySql}
        LIMIT $${params.length + 1}
      )
      DELETE FROM ${table} t
      USING doomed d
      WHERE t.${idColumn} = d.${idColumn}
      RETURNING t.${idColumn}
      `,
      [...params, batchSize],
    );

    const batch = res.rowCount || 0;
    deleted += batch;
    if (batch === 0) break;
  }

  return deleted;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Missing DATABASE_URL.");
    console.error("Example:");
    console.error("  DATABASE_URL=postgres://fastfocus:fastfocus@127.0.0.1:55432/fastfocus");
    process.exitCode = 2;
    return;
  }

  const args = parseArgs(process.argv.slice(2));

  const retention = {
    eventsDays: args.eventsDays ?? envInt("FF_RETENTION_EVENTS_DAYS", 90),
    httpRequestLogsDays: args.httpRequestLogsDays ?? envInt("FF_RETENTION_HTTP_REQUEST_LOGS_DAYS", 14),
    ingestionRunsDays: args.ingestionRunsDays ?? envInt("FF_RETENTION_INGESTION_RUNS_DAYS", 180),
    auditLogDays: args.auditLogDays ?? envInt("FF_RETENTION_AUDIT_LOG_DAYS", 365),
    emailMessagesDays: envInt("FF_RETENTION_EMAIL_MESSAGES_DAYS", 30),
    unsubscribedSavedSearchesDays: envInt("FF_RETENTION_UNSUBSCRIBED_SAVED_SEARCHES_DAYS", 30),
    unconfirmedSavedSearchesDays: envInt("FF_RETENTION_UNCONFIRMED_SAVED_SEARCHES_DAYS", 14),
    unsubscribedNewsletterSubscriptionsDays: envInt("FF_RETENTION_UNSUBSCRIBED_NEWSLETTER_SUBSCRIPTIONS_DAYS", 30),
    unconfirmedNewsletterSubscriptionsDays: envInt("FF_RETENTION_UNCONFIRMED_NEWSLETTER_SUBSCRIPTIONS_DAYS", 14),
    canceledPremiumSubscriptionsDays: envInt("FF_RETENTION_CANCELED_PREMIUM_SUBSCRIPTIONS_DAYS", 30),
    unconfirmedPremiumSubscriptionsDays: envInt("FF_RETENTION_UNCONFIRMED_PREMIUM_SUBSCRIPTIONS_DAYS", 14),
  };

  const plan = [
    { table: "events", idColumn: "event_id", tsColumn: "occurred_at", days: retention.eventsDays },
    { table: "http_request_logs", idColumn: "request_id", tsColumn: "occurred_at", days: retention.httpRequestLogsDays },
    { table: "ingestion_runs", idColumn: "run_id", tsColumn: "started_at", days: retention.ingestionRunsDays },
    { table: "audit_log", idColumn: "audit_id", tsColumn: "created_at", days: retention.auditLogDays },
    { table: "email_messages", idColumn: "email_message_id", tsColumn: "created_at", days: retention.emailMessagesDays },
    { table: "saved_searches", idColumn: "saved_search_id", tsColumn: "unsubscribed_at", days: retention.unsubscribedSavedSearchesDays },
    {
      table: "newsletter_subscriptions",
      idColumn: "newsletter_subscription_id",
      tsColumn: "unsubscribed_at",
      days: retention.unsubscribedNewsletterSubscriptionsDays,
    },
    {
      table: "premium_subscriptions",
      idColumn: "premium_subscription_id",
      tsColumn: "canceled_at",
      days: retention.canceledPremiumSubscriptionsDays,
    },
  ];

  const client = new Client({ connectionString });
  await client.connect();
  try {
    console.log("Retention prune (dry-run by default)");
    console.log("confirm:", args.confirm);
    console.log("batch_size:", args.batchSize);
    console.log("max_batches:", args.maxBatches);
    console.log("retention_days:", retention);

    for (const item of plan) {
      const cutoff = cutoffIso({ days: item.days });
      const count = await countOlderThan(client, { table: item.table, tsColumn: item.tsColumn, cutoff });
      console.log(`${item.table}: cutoff=${cutoff} candidates=${count}`);

      if (!args.confirm) continue;
      const deleted = await deleteOlderThanInBatches(client, {
        table: item.table,
        idColumn: item.idColumn,
        tsColumn: item.tsColumn,
        cutoff,
        batchSize: args.batchSize,
        maxBatches: args.maxBatches,
      });
      console.log(`${item.table}: deleted=${deleted}`);
    }

    {
      const cutoff = cutoffIso({ days: retention.unconfirmedSavedSearchesDays });
      const countRes = await client.query(
        `
        SELECT COUNT(*)::bigint AS c
        FROM saved_searches
        WHERE confirmed_at IS NULL AND created_at < $1
        `,
        [cutoff],
      );
      const candidates = countRes.rows[0] ? Number(countRes.rows[0].c) : 0;
      console.log(`saved_searches_unconfirmed: cutoff=${cutoff} candidates=${candidates}`);

      if (args.confirm) {
        const deleted = await deleteWhereInBatches(client, {
          table: "saved_searches",
          idColumn: "saved_search_id",
          whereSql: "confirmed_at IS NULL AND created_at < $1",
          params: [cutoff],
          orderBySql: "created_at ASC",
          batchSize: args.batchSize,
          maxBatches: args.maxBatches,
        });
        console.log(`saved_searches_unconfirmed: deleted=${deleted}`);
      }
    }

    {
      const cutoff = cutoffIso({ days: retention.unconfirmedNewsletterSubscriptionsDays });
      const countRes = await client.query(
        `
        SELECT COUNT(*)::bigint AS c
        FROM newsletter_subscriptions
        WHERE confirmed_at IS NULL AND created_at < $1
        `,
        [cutoff],
      );
      const candidates = countRes.rows[0] ? Number(countRes.rows[0].c) : 0;
      console.log(`newsletter_subscriptions_unconfirmed: cutoff=${cutoff} candidates=${candidates}`);

      if (args.confirm) {
        const deleted = await deleteWhereInBatches(client, {
          table: "newsletter_subscriptions",
          idColumn: "newsletter_subscription_id",
          whereSql: "confirmed_at IS NULL AND created_at < $1",
          params: [cutoff],
          orderBySql: "created_at ASC",
          batchSize: args.batchSize,
          maxBatches: args.maxBatches,
        });
        console.log(`newsletter_subscriptions_unconfirmed: deleted=${deleted}`);
      }
    }

    {
      const cutoff = cutoffIso({ days: retention.unconfirmedPremiumSubscriptionsDays });
      const countRes = await client.query(
        `
        SELECT COUNT(*)::bigint AS c
        FROM premium_subscriptions
        WHERE confirmed_at IS NULL AND status = 'pending' AND created_at < $1
        `,
        [cutoff],
      );
      const candidates = countRes.rows[0] ? Number(countRes.rows[0].c) : 0;
      console.log(`premium_subscriptions_unconfirmed: cutoff=${cutoff} candidates=${candidates}`);

      if (args.confirm) {
        const deleted = await deleteWhereInBatches(client, {
          table: "premium_subscriptions",
          idColumn: "premium_subscription_id",
          whereSql: "confirmed_at IS NULL AND status = 'pending' AND created_at < $1",
          params: [cutoff],
          orderBySql: "created_at ASC",
          batchSize: args.batchSize,
          maxBatches: args.maxBatches,
        });
        console.log(`premium_subscriptions_unconfirmed: deleted=${deleted}`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
