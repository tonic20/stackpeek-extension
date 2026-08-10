<script lang="ts">
  import { systemTheme, applyTheme, saveTheme, type ThemePreference } from "../../../lib/theme";

  // Read from the document rather than from storage. main.ts applies the stored
  // preference before mount (design D2), so by the time this renders the
  // attribute is already the truth -- and reading it is synchronous, which
  // means the label is right on the first frame instead of correcting itself
  // one microtask later.
  const applied = document.documentElement.getAttribute("data-sp-theme");
  let current: ThemePreference = $state(
    applied === "light" || applied === "dark" ? applied : systemTheme(),
  );

  const next = $derived<ThemePreference>(current === "dark" ? "light" : "dark");

  async function toggle() {
    current = next;
    applyTheme(current);
    await saveTheme(current);
  }
</script>

<!-- aria-pressed is deliberately absent: it describes a control that is on or
     off, and this one selects between two peers. The label carries the state. -->
<button class="sp-iconbtn" type="button" aria-label="Switch to {next} theme" onclick={toggle}>
  {#if next === "dark"}
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z"></path>
    </svg>
  {:else}
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <circle cx="8" cy="8" r="3.25"></circle>
      <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06"></path>
    </svg>
  {/if}
</button>
