<script lang="ts">
  import type { Snippet } from "svelte";
  import { isOpen, setOpen, type SectionId } from "../../../lib/sections.svelte";

  // The disclosure every panel section shares. Previously this markup, and the
  // comment explaining it, was copied into five components.
  //
  // Reads the process-wide sections singleton directly rather than taking open
  // state as a prop -- the same call `lib/theme.ts` makes for the theme
  // preference. That keeps the five call sites free of plumbing, at the cost
  // that Section cannot be rendered twice with the same id (the second copy
  // would show and drive the first's state) and cannot be tested without the
  // module.
  //
  // <details> nests INSIDE <section class="sp-sec"> rather than replacing it:
  // every section carries aria-labelledby, and <details> is not a landmark, so
  // replacing the section would drop the region semantics and orphan the label.
  // Nesting keeps both and costs one element. panel.css already styles the caret
  // on any summary.sp-sec__hd, so this costs no CSS.
  //
  // Open by default -- this is a full-height side panel, and a real finding
  // should not sit behind a click. isOpen() overrides that only where the user
  // has said otherwise (design D3).
  let {
    id,
    heading,
    count,
    children,
  }: {
    id: SectionId;
    heading: string;
    // string as well as number: Theme puts its origin here, and Products puts
    // "" there while the digest loads, because a count of zero would be a wrong
    // answer rather than a pending one.
    count?: string | number;
    children: Snippet;
  } = $props();
</script>

<section class="sp-sec" aria-labelledby="sp-{id}-label">
  <!-- The DOM is the authority, not a local boolean: by the time `toggle`
       fires the browser has already applied the click to the element, so
       reading it back cannot drift out of step with what is on screen. Only
       write to storage when the new state disagrees with the record. A <details>
       starts closed natively; setting open={true} after insertion queues a
       toggle event, but no user asked for it, so we must not record it. -->
  <details
    open={isOpen(id)}
    ontoggle={(e) => {
      const open = e.currentTarget.open;
      if (open !== isOpen(id)) setOpen(id, open);
    }}
  >
    <summary class="sp-sec__hd">
      <span class="sp-label" id="sp-{id}-label">{heading}</span>
      <span class="sp-count">{count ?? ""}</span>
    </summary>

    {@render children()}
  </details>
</section>
