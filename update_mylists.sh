#!/bin/sh

fetch_nicovideo_mylist() {
  local mylist_id="$1" 
 
  for page in {1..5}; do
    curl -s "https://nvapi.nicovideo.jp/v2/mylists/${mylist_id}?pageSize=100&page=${page}&_frontendId=6&_frontendVersion=0" | jq -r ".data.mylist.items.[].watchId" >> "nicovideo_${mylist_id}.txt"
  done

  cat "nicovideo_${mylist_id}.txt" | sort | uniq | sponge "nicovideo_${mylist_id}.txt"
}

fetch_nicovideo_mylist 78076337
fetch_nicovideo_mylist 78110237
fetch_nicovideo_mylist 78982639
fetch_nicovideo_mylist 79112044
fetch_nicovideo_mylist 77541320

cat nicovideo_*.txt | sort | uniq > all.txt