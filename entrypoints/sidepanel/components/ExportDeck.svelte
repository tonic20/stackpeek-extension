<script lang="ts">
  import { i18n } from "#i18n";
  import DownloadIcon from "./DownloadIcon.svelte";
  import { downloadText, reportFilename } from "../../../lib/download";
  import { toReportCsv, toReportJson, toReportMarkdown, type ScanReport } from "../../../lib/report";

  let { scan }: { scan: ScanReport } = $props();

  let copied = $state(false);
  // The clipboard refused and the report went to a file instead. Kept until
  // the next copy rather than timed out like `copied`: it is a sentence, not a
  // word, and it explains a download the user did not ask for -- they need to
  // be able to finish reading it.
  let savedInstead = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  // A clipboard write is invisible when it works, so the button says so. Two
  // seconds is long enough to read and short enough that a second export does
  // not have to wait on it.
  function confirmCopy() {
    copied = true;
    clearTimeout(timer);
    timer = setTimeout(() => (copied = false), 2000);
  }

  async function copyMarkdown() {
    const text = toReportMarkdown(scan);
    savedInstead = false;
    try {
      await navigator.clipboard.writeText(text);
      confirmCopy();
    } catch {
      // Denied by policy, or the panel did not have focus. Losing the report
      // silently is worse than handing over a file the user did not ask for,
      // and the download path needs no permission either -- but the file has
      // to be explained. Without a word, the user pastes whatever was on the
      // clipboard before and concludes the button is broken.
      downloadText(reportFilename(scan.domain, scan.scannedAt, "md"), text, "text/markdown;charset=utf-8");
      savedInstead = true;
    }
  }

  // What the live region says. The button's own label changing to "Copied" is
  // not announced by every screen reader -- a focused control's name changing
  // is not a live-region update -- so the outcome is said here as well.
  const announcement = $derived(
    savedInstead ? i18n.t("report.copyFailed") : copied ? i18n.t("report.copied") : "",
  );

  const saveCsv = () =>
    downloadText(reportFilename(scan.domain, scan.scannedAt, "csv"), toReportCsv(scan), "text/csv;charset=utf-8");

  const saveJson = () =>
    downloadText(reportFilename(scan.domain, scan.scannedAt, "json"), toReportJson(scan), "application/json;charset=utf-8");
</script>

<div class="sp-deck">
  <button type="button" class="sp-btn sp-btn--export sp-deck__btn" onclick={copyMarkdown}>
    {copied ? i18n.t("report.copied") : i18n.t("report.copyMarkdown")}
  </button>
  <button type="button" class="sp-btn sp-btn--export sp-deck__btn" onclick={saveCsv}>
    <DownloadIcon />{i18n.t("report.csv")}
  </button>
  <button type="button" class="sp-btn sp-btn--export sp-deck__btn" onclick={saveJson}>
    <DownloadIcon />{i18n.t("report.json")}
  </button>
  <!-- Rendered from the start, empty: a live region inserted together with its
       text is not reliably announced. Absolutely positioned, so it is no flex
       item and adds no row to the deck. -->
  <span class="sr" role="status">{announcement}</span>
  <!-- The same sentence for sighted users, on a row of its own (.sp-hint is
       full-width in a wrapping row). aria-hidden because the region above has
       already said it. -->
  {#if savedInstead}
    <p class="sp-hint" aria-hidden="true">{i18n.t("report.copyFailed")}</p>
  {/if}
</div>

<style>
  /* See AppList: panel.css has no visually-hidden helper. */
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
