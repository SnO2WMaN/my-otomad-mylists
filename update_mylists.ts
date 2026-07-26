import { write } from "bun";

const OUTDIR = process.env.OUTDIR ?? "dist";

const MYLIST_IDS = [
  78076337,
  78110237,
  78982639,
  79112044,
  77541320,
  79481663,
];

const PAGE_SIZE = 100;
const MAX_PAGES = 5;

type MylistResponse = {
  data: { mylist: { items: { watchId: string }[] } };
};

async function fetchNicovideoMylist(mylistId: number): Promise<string[]> {
  const watchIds: string[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(`https://nvapi.nicovideo.jp/v2/mylists/${mylistId}`);
    url.searchParams.set("pageSize", String(PAGE_SIZE));
    url.searchParams.set("page", String(page));
    url.searchParams.set("_frontendId", "6");
    url.searchParams.set("_frontendVersion", "0");

    const res = await fetch(url, {
      headers: { "User-Agent": "Googlebot/2.1" },
    });
    if (!res.ok) {
      throw new Error(
        `failed to fetch nicovideo mylist ${mylistId} page ${page}: ${res.status} ${res.statusText}`,
      );
    }

    const { data } = await res.json() as MylistResponse;
    const items = data.mylist.items;
    for (const item of items) watchIds.push(item.watchId);

    if (items.length < PAGE_SIZE) break;
  }

  return watchIds;
}

function toFile(watchIds: string[]): string {
  const sorted = [...new Set(watchIds)].sort();
  return sorted.length === 0 ? "" : `${sorted.join("\n")}\n`;
}

const all: string[] = [];

for (const mylistId of MYLIST_IDS) {
  const watchIds = await fetchNicovideoMylist(mylistId);
  all.push(...watchIds);

  const contents = toFile(watchIds);
  await write(`${OUTDIR}/nicovideo_${mylistId}.txt`, contents);
  console.log(
    `done nicovideo mylist ${mylistId} with ${new Set(watchIds).size} items.`,
  );
}

await write(`${OUTDIR}/nicovideo_all.txt`, toFile(all));
console.log(`done nicovideo mylist all with ${new Set(all).size} items.`);
