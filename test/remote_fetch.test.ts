// scripts/remote_fetch.sh, run for real against a stub curl.
//
// The branch under test cannot be read off the source honestly: it turns on
// what the 40th page of /products.json came back holding, which only a walk
// can produce. So this drives the actual script -- one fake curl on PATH, a
// throwaway HOME so its output tree lands under test/, and GAP=0 so 44 paced
// requests take milliseconds instead of six minutes.
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SCRIPT = resolve(__dirname, "../scripts/remote_fetch.sh");

// Answers every request the script makes. FULL_PAGES says how many pages of
// /products.json come back holding a full 250 products; the page after it comes
// back partial but NOT empty, which is the case the old gate could not see.
const FAKE_CURL = `#!/bin/bash
dest=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) dest="$2"; shift 2 ;;
    -A|-w|--max-time) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done

products() {
  local n="$1" i=1 body='{"products":['
  while [ "$i" -le "$n" ]; do
    [ "$i" -gt 1 ] && body="$body,"
    body="$body{\\"handle\\":\\"p$i\\"}"
    i=$((i + 1))
  done
  printf '%s]}' "$body"
}

case "$url" in
  *products.json*)
    page=\${url##*page=}
    if [ "$page" -le "$FULL_PAGES" ]; then products 250 > "$dest"
    elif [ "$page" -eq $((FULL_PAGES + 1)) ]; then products 100 > "$dest"
    else printf '{"products":[]}' > "$dest"
    fi ;;
  *sitemap.xml)
    printf '<sitemapindex><sitemap><loc>https://s.example/sitemap_products_1.xml</loc></sitemap></sitemapindex>' > "$dest" ;;
  *sitemap_products*)
    printf '<urlset><url><loc>https://s.example/products/a</loc></url></urlset>' > "$dest" ;;
  *) printf 'ok' > "$dest" ;;
esac
echo 200
`;

describe("remote_fetch.sh", () => {
  const built: string[] = [];
  afterEach(() => {
    while (built.length) rmSync(built.pop()!, { recursive: true, force: true });
  });

  // Returns the capture directory the script produced for s.example.
  function run(fullPages: number): string {
    const home = mkdtempSync(resolve(__dirname, "fetch-"));
    built.push(home);
    const bin = resolve(home, "bin");
    mkdirSync(bin);
    writeFileSync(resolve(bin, "curl"), FAKE_CURL);
    chmodSync(resolve(bin, "curl"), 0o755);
    mkdirSync(resolve(home, "stackpeek-capture"));
    writeFileSync(resolve(home, "stackpeek-capture", "domains.txt"), "s.example\n");

    execFileSync("bash", [ SCRIPT ], {
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        GAP: "0",
        FULL_PAGES: String(fullPages),
      },
      stdio: "pipe",
    });
    return resolve(home, "stackpeek-capture", "s.example");
  }

  const sitemapFiles = (dir: string) =>
    readdirSync(dir).filter((f) => f.startsWith("sitemap"));

  // The bug: the old gate asked only whether the walk ran out of PAGES, and a
  // store with 9,751-9,999 products satisfies that while its catalogue was in
  // fact read completely. Page 40 comes back with 100 products here -- partial,
  // but not the empty array that was the only short-circuit -- so the loop ran
  // to its end and fired dozens of sitemap requests at a throttle we know is
  // fragile, where a single 429 would then have withheld .done and discarded a
  // capture that had already fully succeeded.
  it("fetches no sitemaps when the last page came back partial", () => {
    const dir = run(39);

    expect(sitemapFiles(dir)).toEqual([]);
    expect(readFileSync(resolve(dir, "status"), "utf8")).not.toMatch(/^sitemap/m);
    // Still a complete, honest capture: the walk read the whole catalogue.
    expect(existsSync(resolve(dir, ".done"))).toBe(true);
  });

  // The other half of the gate: a genuinely capped store must still be counted.
  it("fetches the sitemaps when the last page came back full", () => {
    const dir = run(40);

    expect(sitemapFiles(dir).sort()).toEqual([ "sitemap-products-1.xml", "sitemap.xml" ]);
    expect(existsSync(resolve(dir, ".done"))).toBe(true);
  });
});
