<script lang="ts">
  // No props: the arrow is the same everywhere it appears, and its size comes
  // from `.sp-btn--export svg` in panel.css.
</script>

<!-- The download arrow, in one place. It marks the catalogue export and both
     findings downloads; spelling the path out three times is how two of them
     end up a pixel apart after someone tweaks the third. Sized by
     `.sp-btn--export svg` in panel.css, so it carries no dimensions itself. -->
<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  <path d="M8 2v8M4.5 7 8 10.5 11.5 7M2.5 13h11"></path>
</svg>
