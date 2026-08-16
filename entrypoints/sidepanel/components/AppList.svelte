<script lang="ts">
  import Section from "./Section.svelte";
  import { heldLinkClick } from "../../../lib/held_tabs";
  import { i18n } from "#i18n";

  type App = {
    name: string;
    category: string;
    category_slug: string;
    app_store_url?: string;
    verified?: boolean;
  };
  let { apps = [] }: { apps?: App[] } = $props();

  // The server orders apps by category position then name (app-categories D3)
  // and ships the slug, so arrival order IS display order and grouping only has
  // to preserve it. Two things this deliberately does NOT do:
  //
  //   - filter against a whitelist. The reference component names six
  //     categories; there are 27, and the other 21 would silently vanish.
  //   - kebab-case the category name. The slug is the server's, and it is the
  //     same key the homepage demo reads. Deriving it twice is how the two
  //     drifted apart in the first place.
  //
  // Built with an explicit loop rather than Object.groupBy: that reorders
  // integer-like keys, so a category ever named "2024" would jump the queue.
  const groups = $derived.by(() => {
    const out: { category: string; key: string; items: App[] }[] = [];
    // Keyed by the group itself rather than its index: same insertion order,
    // but it drops the out[at] read that noUncheckedIndexedAccess can't prove
    // is in bounds.
    const seen = new Map<string, (typeof out)[number]>();
    for (const app of apps) {
      let group = seen.get(app.category);
      if (group === undefined) {
        group = { category: app.category, key: app.category_slug, items: [] };
        seen.set(app.category, group);
        out.push(group);
      }
      group.items.push(app);
    }
    return out;
  });

  // Two rules the design bundle's reference component fused, separated here
  // (design D3).
  //
  // "unverified" is a COMPARATIVE claim: it means "matched on weaker evidence
  // than the others here", which is only true of anything if the scan holds
  // BOTH kinds. Today the catalogue has no verified apps at all -- 0 of 699
  // rows carry verified_at -- and flagging 8 of 8 would mark everything and
  // distinguish nothing. This self-corrects the moment triage backfills the
  // column, with no code change here.
  //
  // Both halves are load-bearing, and the second is easy to drop as redundant.
  // It is not: with every app verified, no .sp-flag can render (nothing
  // satisfies !verified) but the footnote below is gated on the same value, and
  // would sit there explaining a marker that is nowhere on screen.
  //
  // Whether an app LINKS is a separate question, and it is answered by
  // app_store_url alone: how strong the fingerprint match was says nothing
  // about whether the listing exists.
  const showFlags = $derived(apps.some((a) => a.verified) && apps.some((a) => !a.verified));
</script>

<Section id="apps" heading={i18n.t("apps.heading")} count={apps.length}>
  <div class="sp-cats">
    {#each groups as group (group.category)}
      <div class="sp-cat" data-sp-cat={group.key}>
        <span class="sp-cat__label">{group.category}</span>
        <ul class="sp-items">
          {#each group.items as app (app.name)}
            <li class="sp-item">
              {#if app.app_store_url}
                <a class="sp-item__name" href={app.app_store_url} target="_blank" rel="noreferrer" onclick={heldLinkClick}>{app.name}</a>
              {:else}
                <span class="sp-item__name">{app.name}</span>
              {/if}
              {#if !app.verified && showFlags}
                <span class="sp-flag" title={i18n.t("apps.unverifiedTitle")}>{i18n.t("apps.unverified")}</span>
                <span class="sr">{i18n.t("apps.unverifiedSr")}</span>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </div>

  {#if showFlags}
    <p class="sp-foot-note">{i18n.t("apps.unverifiedNote")}</p>
  {/if}
</Section>

<style>
  /* See ThemeCard: the one helper panel.css lacks. The flag's title attribute
     never reaches a keyboard or screen-reader user, so the meaning needs a
     hidden sentence beside it. */
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
