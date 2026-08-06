const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

export async function purgeExpiredVisits(
  db: D1Database,
  now: Date,
  retentionDays = 90
): Promise<void> {
  const cutoff = new Date(
    now.getTime() - retentionDays * MILLISECONDS_PER_DAY
  ).toISOString();

  await db
    .prepare("DELETE FROM visits WHERE visited_at_utc < ?")
    .bind(cutoff)
    .run();
}
