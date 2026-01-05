#!/bin/sh

fetch_nicovideo_mylist() {
  local mylist_id="$1" 
  local filename="nicovideo_${mylist_id}.txt"
 
  for page in {1..5}; do
    http GET "https://nvapi.nicovideo.jp/v2/mylists/${mylist_id}" \
      pageSize==1 \
      page==${page} \
      _frontendId==6 \
      _frontendVersion==0 \
      User-Agent:"Googlebot/2.1"
  done

  cat "$filename" | sort | uniq | sponge "$filename"

  echo done nicovideo mylist ${mylist_id} with $(wc -l < "$filename") items.
}

fetch_nicovideo_mylist 78076337
fetch_nicovideo_mylist 78110237
fetch_nicovideo_mylist 78982639
fetch_nicovideo_mylist 79112044
fetch_nicovideo_mylist 77541320

cat nicovideo_*.txt | sort | uniq > nicovideo_all.txt
echo done nicovideo mylist all with $(wc -l < "nicovideo_all.txt") items.