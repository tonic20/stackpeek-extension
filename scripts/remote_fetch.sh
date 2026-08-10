#!/bin/bash
# Fetches the raw responses the catalogue capture needs, and nothing else.
#
# Deliberately dumb: it computes no digest and no ranking. Those are the
# extension's own modules and stay in one place -- this only gathers the bytes
# they would have fetched, so the analysis still runs against the shipped code.
#
# Installs nothing. curl, tar and gzip only.
set -u

OUT="$HOME/stackpeek-capture"
GAP=8           # between requests, seconds
RETRY_WAIT=45   # first backoff on a 429
MAX_RETRY=3
MAX_PAGES=40

mkdir -p "$OUT"

# $1 url, $2 destination file, $3 status label -> echoes the final HTTP code
fetch() {
  local url="$1" dest="$2" label="$3" attempt=0 code wait

  while :; do
    sleep "$GAP"
    code=$(curl -sSL --max-time 60 --compressed \
                -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" \
                -o "$dest" -w '%{http_code}' "$url" 2>/dev/null)

    if [ "$code" != "429" ] || [ "$attempt" -ge "$MAX_RETRY" ]; then
      break
    fi
    wait=$((RETRY_WAIT * (attempt + 1)))
    echo "    429, waiting ${wait}s" >&2
    sleep "$wait"
    attempt=$((attempt + 1))
  done

  echo "$label $code" >> "$STATUS"
  echo "$code"
}

while IFS= read -r domain; do
  case "$domain" in ""|\#*) continue ;; esac

  dir="$OUT/$domain"
  # Resumable: a domain that already finished is left alone, so this can be
  # re-run after an interruption without re-fetching anything.
  if [ -f "$dir/.done" ]; then
    echo "$domain: already fetched"
    continue
  fi

  mkdir -p "$dir"
  STATUS="$dir/status"
  : > "$STATUS"
  echo "$domain"

  fetch "https://$domain/" "$dir/home.html" "home" > /dev/null
  # The shop currency, for storefronts that do not inline window.Shopify in the
  # HTML we can see. A genuinely headless front end 404s this, which the reader
  # treats as "no currency" rather than guessing one.
  fetch "https://$domain/cart.js" "$dir/cart.json" "cart" > /dev/null

  page=1
  while [ "$page" -le "$MAX_PAGES" ]; do
    code=$(fetch "https://$domain/products.json?limit=250&page=$page" \
                 "$dir/products-$page.json" "products-$page")
    [ "$code" = "200" ] || break
    # One extra empty page rather than parsing counts in shell: the local side
    # does the real parsing, and guessing here is how a truncated feed gets
    # reported as a whole one.
    grep -q '"products":\[\]' "$dir/products-$page.json" && break
    page=$((page + 1))
  done

  if [ -s "$dir/products-1.json" ] && grep -q '"products"' "$dir/products-1.json"; then
    fetch "https://$domain/collections/all?sort_by=best-selling&view=json" \
          "$dir/best-selling.html" "best-selling" > /dev/null
    fetch "https://$domain/collections/all?sort_by=title-ascending&view=json" \
          "$dir/alphabetical.html" "alphabetical" > /dev/null
  fi

  touch "$dir/.done"
  echo "  $(grep -c . "$STATUS") requests, codes: $(cut -d' ' -f2 "$STATUS" | sort -u | tr '\n' ' ')"
done < "$OUT/domains.txt"

echo "ALL DONE"
