// lib/db/migrate.ts
if (!process.env.POSTGRES_URL) {
  console.log('[migrate] No POSTGRES_URL, skip migration.');
  process.exit(0);
}

// …原本的 migrate 程式碼留著…
