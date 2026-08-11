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
# Seconds between requests. 8 is the pacing Shopify's per-IP throttle needs and
# is what every real run uses; it is overridable ONLY so test/remote_fetch can
# walk 40 pages against a stub curl without waiting out five minutes of it.
GAP=${GAP:-8}
RETRY_WAIT=45   # first backoff on a 429
MAX_RETRY=3
MAX_PAGES=40

mkdir -p "$OUT"

# $1 url, $2 destination file, $3 status label -> echoes the final HTTP code
fetch() {
  local url="$1" dest="$2" label="$3" attempt=0 code wait

  while :; do
    sleep "$GAP"
    # No --compressed. Measured 2026-08-11: sending curl's Accept-Encoding
    # alongside a browser User-Agent makes kith.com and yosekastationery.com
    # answer 403 where the identical request without it answers 200 --
    # reproducible, and it flips back cleanly. The mismatch reads as a spoofed
    # browser to Shopify's bot protection. The bodies are small enough that
    # transfer size was never the point.
    code=$(curl -sSL --max-time 60 \
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
  # Whether the page just fetched came back FULL, which is the only thing that
  # distinguishes a walk that ran out of pages from one that ran out of
  # products. Counting `"handle":` occurrences is enough to tell the two apart:
  # every product object in /products.json carries exactly one, and no variant,
  # option or image does (verified against a captured page: exactly 250). A
  # product description that happens to contain the same text cannot inflate it
  # either -- body_html is JSON-escaped, so the key would read `\"handle\":`
  # there and the pattern below does not match that. This is still not parsing
  # the feed -- the local side does the real parsing, per the note below -- it
  # is one integer used for one branch.
  last_page_full=0
  while [ "$page" -le "$MAX_PAGES" ]; do
    code=$(fetch "https://$domain/products.json?limit=250&page=$page" \
                 "$dir/products-$page.json" "products-$page")
    if [ "$code" != "200" ]; then
      last_page_full=0
      break
    fi
    # Covers the empty-page case too, which used to have its own grep: an empty
    # "products":[] counts zero handles, which is short, which stops the walk.
    products=$(grep -o '"handle":' "$dir/products-$page.json" | wc -l | tr -d '[:space:]')
    if [ "${products:-0}" -lt 250 ]; then
      last_page_full=0
      break
    fi
    last_page_full=1
    page=$((page + 1))
  done

  # BOTH conditions, and the second is the one that used to be missing. `page`
  # past MAX_PAGES alone only says the loop ran out of iterations; a store with
  # 9,751-9,999 products returns a partial-but-non-empty page 40 and satisfies
  # it while its catalogue was in fact read COMPLETELY. The sitemap branch then
  # fired for a store that never capped -- dozens of pointless requests against
  # a per-IP throttle we know is fragile, and a single 429 among them trips the
  # rule below that withholds .done, discarding a 40-page capture that had
  # already fully succeeded.
  #
  # With page 40 full, the feed really is bigger than the 40x250 the reader can
  # walk, so the count it computes is a floor, not a total. /sitemap.xml knows
  # the real total, and knows it without pagination, so capture the index and
  # the per-product sitemaps it lists; the local replay counts the product URLs
  # across them.
  #
  # Only for capped stores, which is why the request count is acceptable:
  # kith.com indexes 35 product sitemaps, i.e. 36 extra requests at the usual
  # pacing. Every other store adds none.
  if [ "$page" -gt "$MAX_PAGES" ] && [ "$last_page_full" -eq 1 ]; then
    echo "  page $MAX_PAGES came back full -- the feed exceeds the walk; fetching sitemaps for the true total"
    if [ "$(fetch "https://$domain/sitemap.xml" "$dir/sitemap.xml" "sitemap")" = "200" ]; then
      # grep -o puts each <loc> on its own line, which matters: Shopify serves
      # the index as one long line, so a line-oriented filter would otherwise
      # see a single blob and fetch nothing. The &amp; unescape is not cosmetic
      # -- these URLs carry ?from=&to= ranges, and the entity is XML's, not the
      # URL's; fetching it verbatim asks for a query string the store does not
      # have.
      grep -o '<loc>[^<]*</loc>' "$dir/sitemap.xml" |
        sed -e 's/<[^>]*>//g' -e 's/&amp;/\&/g' | grep -i 'product' |
        while IFS= read -r loc; do
          n=$((${n:-0} + 1))
          fetch "$loc" "$dir/sitemap-products-$n.xml" "sitemap-products-$n" > /dev/null
        done
    fi
  fi

  if [ -s "$dir/products-1.json" ] && grep -q '"products"' "$dir/products-1.json"; then
    fetch "https://$domain/collections/all?sort_by=best-selling&view=json" \
          "$dir/best-selling.html" "best-selling" > /dev/null
    fetch "https://$domain/collections/all?sort_by=title-ascending&view=json" \
          "$dir/alphabetical.html" "alphabetical" > /dev/null
  fi

  # .done is what the local replay trusts: capture_catalogue.ts skips any domain
  # without it, and treats every domain WITH it as a complete, honest fetch. So
  # it must never be written over a blocked run.
  #
  # 404 and 403/429 are opposite facts, and this is the line between them:
  #
  #   404 -> the store answered, and it has no public feed. Real data. The
  #          replay is right to record available: false.
  #   403/429 -> WE were blocked. We learned nothing about the store. Marking
  #          this done would turn our own throttling into a published claim
  #          that a merchant's catalogue is private -- measured on kith.com and
  #          yosekastationery.com, which 403 every request under one curl flag
  #          and serve 250 products a second later without it.
  #
  # Same distinction the panel draws between "not public" and "couldn't read",
  # for the same reason.
  if grep -qE ' (403|429)$' "$STATUS"; then
    echo "  BLOCKED -- $(grep -cE ' (403|429)$' "$STATUS") of $(grep -c . "$STATUS") requests refused; not marking done" >&2
    echo "  re-run from an IP this store will talk to; the replay will skip it until then" >&2
    continue
  fi

  touch "$dir/.done"
  echo "  $(grep -c . "$STATUS") requests, codes: $(cut -d' ' -f2 "$STATUS" | sort -u | tr '\n' ' ')"
done < "$OUT/domains.txt"

echo "ALL DONE"
