<!-- Empty, and load-bearing: without a lang="ts" script block svelte-check
     cannot type this module and reports the import in App.svelte as implicitly
     any. This component takes no props and has no logic. -->
<script lang="ts"></script>

<!--
  The first round's placeholder. A skeleton is a promise about the next frame,
  so it previews what will actually arrive: Theme, Apps, Trackers,
  Infrastructure. The bundle's fourth panel is Products, which is not a built
  feature -- promising a section that never renders is the same fiction the
  demo spec exists to remove (design D6).

  The label sits in .sp-sec__hd rather than loose in .sp-sec because that is
  where the real sections put it, and it is the only thing in panel.css that
  gives the label its space below. A skeleton whose spacing does not match the
  frame it promises is a worse lie than a missing one.

  aria-hidden: there is nothing here to read out. The header's .sp-scan carries
  the live "Scanning…" status.
-->
<div aria-hidden="true">
  <section class="sp-sec">
    <div class="sp-sec__hd"><span class="sp-label">Theme</span></div>
    <div class="sp-skel sp-skel--theme"></div>
  </section>

  <section class="sp-sec">
    <div class="sp-sec__hd"><span class="sp-label">Apps</span></div>
    <div class="sp-skel-rows">
      <div class="sp-skel sp-skel--row" style="width:38%"></div>
      <div class="sp-skel sp-skel--row" style="width:72%"></div>
      <div class="sp-skel sp-skel--row" style="width:60%"></div>
      <div class="sp-skel sp-skel--row" style="width:44%"></div>
      <div class="sp-skel sp-skel--row" style="width:66%"></div>
    </div>
  </section>

  <section class="sp-sec">
    <div class="sp-sec__hd"><span class="sp-label">Trackers</span></div>
    <div class="sp-skel-rows">
      <div class="sp-skel sp-skel--row" style="width:54%"></div>
    </div>
  </section>

  <section class="sp-sec">
    <div class="sp-sec__hd"><span class="sp-label">Infrastructure</span></div>
    <div class="sp-skel-rows">
      <div class="sp-skel sp-skel--row" style="width:48%"></div>
      <div class="sp-skel sp-skel--row" style="width:36%"></div>
    </div>
  </section>
</div>
