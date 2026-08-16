<!-- The script block was empty and load-bearing: without lang="ts",
     svelte-check cannot type this module and reports the import in App.svelte
     as implicitly any. It now also holds the i18n import -- the labels below
     are the same five the real sections use, and they read the same keys, so a
     renamed section cannot leave the skeleton promising the old name. -->
<script lang="ts">
  import { i18n } from "#i18n";
</script>

<!--
  The first round's placeholder. A skeleton is a promise about the next frame,
  so it previews what will actually arrive: Theme, Apps, Trackers,
  Infrastructure, and Products. Best sellers is omitted because that section
  renders only when a product ranking was actually proven, so promising it would
  recreate the fiction the demo spec exists to remove (design D6).

  The label sits in .sp-sec__hd rather than loose in .sp-sec because that is
  where the real sections put it, and it is the only thing in panel.css that
  gives the label its space below. A skeleton whose spacing does not match the
  frame it promises is a worse lie than a missing one.

  aria-hidden: there is nothing here to read out. The header's .sp-scan carries
  the live "Scanning…" status.
-->
<div aria-hidden="true">
  <section class="sp-sec">
    <div class="sp-sec__hd"><span class="sp-label">{i18n.t("theme.heading")}</span></div>
    <div class="sp-skel sp-skel--theme"></div>
  </section>

  <section class="sp-sec">
    <div class="sp-sec__hd"><span class="sp-label">{i18n.t("apps.heading")}</span></div>
    <div class="sp-skel-rows">
      <div class="sp-skel sp-skel--row" style="width:38%"></div>
      <div class="sp-skel sp-skel--row" style="width:72%"></div>
      <div class="sp-skel sp-skel--row" style="width:60%"></div>
      <div class="sp-skel sp-skel--row" style="width:44%"></div>
      <div class="sp-skel sp-skel--row" style="width:66%"></div>
    </div>
  </section>

  <section class="sp-sec">
    <div class="sp-sec__hd"><span class="sp-label">{i18n.t("trackers.heading")}</span></div>
    <div class="sp-skel-rows">
      <div class="sp-skel sp-skel--row" style="width:54%"></div>
    </div>
  </section>

  <section class="sp-sec">
    <div class="sp-sec__hd"><span class="sp-label">{i18n.t("infrastructure.heading")}</span></div>
    <div class="sp-skel-rows">
      <div class="sp-skel sp-skel--row" style="width:48%"></div>
      <div class="sp-skel sp-skel--row" style="width:36%"></div>
    </div>
  </section>

  <section class="sp-sec">
    <div class="sp-sec__hd"><span class="sp-label">{i18n.t("products.heading")}</span></div>
    <div class="sp-skel-rows">
      <div class="sp-skel sp-skel--row" style="width:42%"></div>
      <div class="sp-skel sp-skel--row" style="width:56%"></div>
      <div class="sp-skel sp-skel--row" style="width:38%"></div>
    </div>
  </section>
</div>
