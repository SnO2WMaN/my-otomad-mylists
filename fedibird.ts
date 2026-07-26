const SERVER = process.env.FEDIBIRD_SERVER ?? "https://fedibird.com";
const ACCESS_TOKEN = process.env.FEDIBIRD_ACCESS_TOKEN;
const VISIBILITY = process.env.FEDIBIRD_VISIBILITY ?? "unlisted";
const DRY_RUN = process.env.FEDIBIRD_DRY_RUN === "1";

/** Fedibird rejects a burst of statuses, so space them out. */
const INTERVAL_MS = Number(process.env.FEDIBIRD_INTERVAL_MS ?? 3000);

export function isConfigured(): boolean {
  return DRY_RUN || ACCESS_TOKEN !== undefined;
}

/**
 * Post a status. `idempotencyKey` lets Fedibird collapse duplicates, so a
 * re-run that sees the same diff (e.g. because the previous run failed before
 * the new list was published) does not post twice.
 */
export async function postStatus(
  status: string,
  idempotencyKey: string,
): Promise<void> {
  if (DRY_RUN) {
    console.log(`[dry-run] would post as ${VISIBILITY}:\n${status}\n`);
    return;
  }
  if (ACCESS_TOKEN === undefined) {
    throw new Error("FEDIBIRD_ACCESS_TOKEN is not set");
  }

  const res = await fetch(`${SERVER}/api/v1/statuses`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ status, visibility: VISIBILITY }),
  });
  if (!res.ok) {
    throw new Error(
      `failed to post to fedibird: ${res.status} ${res.statusText}: ${await res
        .text()}`,
    );
  }
}

export async function waitBetweenPosts(): Promise<void> {
  if (DRY_RUN || INTERVAL_MS <= 0) return;
  await Bun.sleep(INTERVAL_MS);
}
