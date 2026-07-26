import { write } from "bun";

import { isConfigured, postStatus, waitBetweenPosts } from "./fedibird.ts";

const OUTDIR = process.env.OUTDIR ?? "dist";

/** Where the previous run's lists are published, used to compute the diff. */
const PAGES_BASE_URL = process.env.PAGES_BASE_URL ??
  "https://sno2wman.github.io/my-otomad-mylists";

/**
 * Safety valve: a diff larger than this is almost certainly a mistake (a
 * mylist being rebuilt, the published lists going missing), and posting it
 * would flood the timeline.
 */
const MAX_POSTS_PER_MYLIST = Number(process.env.MAX_POSTS_PER_MYLIST ?? 50);

/** `notify` mylists get their newly added videos posted to Fedibird. */
const MYLISTS = [
  { id: 78076337, notify: true },
  { id: 78110237, notify: true },
  { id: 78982639, notify: true },
  { id: 79112044, notify: true },
  { id: 77541320, notify: false },
  { id: 79481663, notify: true },
];

const PAGE_SIZE = 100;
/**
 * Only a bound on runaway pagination; the loop stops on hasNext long before
 * this. Truncating instead would make the dropped videos look newly added on
 * the next run, so overrunning it is an error rather than a silent cut-off.
 */
const MAX_PAGES = 10;

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

type Video = { watchId: string; title: string };

type Mylist = {
  hasNext: boolean;
  hasInvisibleItems: boolean;
  totalItemCount: number;
  items: { watchId: string; video: { title: string } }[];
};

async function fetchMylistPage(
  mylistId: number,
  page: number,
): Promise<Mylist> {
  const url = new URL(`https://nvapi.nicovideo.jp/v2/mylists/${mylistId}`);
  url.searchParams.set("pageSize", String(PAGE_SIZE));
  url.searchParams.set("page", String(page));
  url.searchParams.set("_frontendId", "6");
  url.searchParams.set("_frontendVersion", "0");

  const res = await fetch(url, { headers: { "User-Agent": "Googlebot/2.1" } });
  if (!res.ok) {
    throw new Error(
      `failed to fetch nicovideo mylist ${mylistId} page ${page}: ${res.status} ${res.statusText}`,
    );
  }

  const { data } = await res.json() as { data: { mylist: Mylist } };
  return data.mylist;
}

async function fetchNicovideoMylistOnce(mylistId: number): Promise<Video[]> {
  const videos = new Map<string, Video>();
  let mylist: Mylist | undefined;

  for (let page = 1; page <= MAX_PAGES; page++) {
    mylist = await fetchMylistPage(mylistId, page);
    for (const item of mylist.items) {
      videos.set(item.watchId, {
        watchId: item.watchId,
        title: item.video.title,
      });
    }

    // A page can hold fewer than pageSize items without being the last one, so
    // hasNext is the only reliable end marker.
    if (!mylist.hasNext) break;

    if (page === MAX_PAGES) {
      throw new Error(
        `nicovideo mylist ${mylistId} has more than ${MAX_PAGES} pages; raise MAX_PAGES`,
      );
    }
  }

  // The API intermittently serves short pages, which would silently truncate
  // the list. Publishing a truncated list is worse than failing: the dropped
  // videos would look newly added on the next run and get posted again.
  const { totalItemCount, hasInvisibleItems } = mylist!;
  if (videos.size !== totalItemCount) {
    if (hasInvisibleItems && videos.size < totalItemCount) {
      console.warn(
        `nicovideo mylist ${mylistId}: got ${videos.size} of ${totalItemCount} items, the rest are invisible.`,
      );
    } else {
      throw new Error(
        `nicovideo mylist ${mylistId}: got ${videos.size} items but totalItemCount is ${totalItemCount}`,
      );
    }
  }

  return [...videos.values()];
}

async function fetchNicovideoMylist(mylistId: number): Promise<Video[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchNicovideoMylistOnce(mylistId);
    } catch (cause) {
      if (attempt === MAX_ATTEMPTS) throw cause;
      console.warn(`retrying nicovideo mylist ${mylistId}:`, cause);
      await Bun.sleep(RETRY_DELAY_MS * attempt);
    }
  }
}

/**
 * The watchIds published by the previous run, or `null` when there is nothing
 * to compare against yet. `null` means "do not post": without a baseline every
 * video in the mylist would look new.
 */
async function fetchPublishedWatchIds(
  mylistId: number,
): Promise<Set<string> | null> {
  const url = `${PAGES_BASE_URL}/nicovideo_${mylistId}.txt`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (cause) {
    console.warn(`could not reach ${url}, skipping diff:`, cause);
    return null;
  }
  if (res.status === 404) {
    console.warn(`${url} is not published yet, skipping diff.`);
    return null;
  }
  if (!res.ok) {
    throw new Error(`failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  return new Set(text.split("\n").filter((line) => line !== ""));
}

function toFile(watchIds: string[]): string {
  const sorted = [...new Set(watchIds)].sort();
  return sorted.length === 0 ? "" : `${sorted.join("\n")}\n`;
}

async function postAddedVideos(
  mylistId: number,
  videos: Video[],
): Promise<void> {
  const published = await fetchPublishedWatchIds(mylistId);
  if (published === null) return;

  // The API returns newest first; post oldest first so the timeline reads in
  // the order the videos were added.
  const added = videos
    .filter((video) => !published.has(video.watchId))
    .reverse();
  if (added.length === 0) return;

  const posting = added.slice(0, MAX_POSTS_PER_MYLIST);
  if (posting.length < added.length) {
    console.warn(
      `mylist ${mylistId} has ${added.length} new videos, over the ${MAX_POSTS_PER_MYLIST} cap; not posting: ${
        added.slice(MAX_POSTS_PER_MYLIST).map((v) => v.watchId).join(" ")
      }`,
    );
  }

  for (const [index, video] of posting.entries()) {
    if (index > 0) await waitBetweenPosts();
    await postStatus(
      `${video.title}\nhttps://www.nicovideo.jp/watch/${video.watchId}`,
      video.watchId,
    );
    console.log(`posted ${video.watchId} from mylist ${mylistId}.`);
  }
}

const canPost = isConfigured();
if (!canPost) {
  console.warn("FEDIBIRD_ACCESS_TOKEN is not set, not posting anything.");
}

const all: string[] = [];

for (const { id, notify } of MYLISTS) {
  const videos = await fetchNicovideoMylist(id);
  const watchIds = videos.map((video) => video.watchId);
  all.push(...watchIds);

  if (notify && canPost) await postAddedVideos(id, videos);

  await write(`${OUTDIR}/nicovideo_${id}.txt`, toFile(watchIds));
  console.log(`done nicovideo mylist ${id} with ${new Set(watchIds).size} items.`);
}

await write(`${OUTDIR}/nicovideo_all.txt`, toFile(all));
console.log(`done nicovideo mylist all with ${new Set(all).size} items.`);
