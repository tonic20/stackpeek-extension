<script lang="ts">
  import { i18n } from "#i18n";
  import DownloadIcon from "./DownloadIcon.svelte";
  import { downloadText, reportFilename } from "../../../lib/download";
  import { toReportCsv, toReportJson, toReportMarkdown, type ScanReport } from "../../../lib/report";

  let { scan }: { scan: ScanReport } = $props();

  let copied = $state(false);
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
    try {
      await navigator.clipboard.writeText(text);
      confirmCopy();
    } catch {
      // Denied by policy, or the panel did not have focus. Losing the report
      // silently is worse than handing over a file the user did not ask for,
      // and the download path needs no permission either.
      downloadText(reportFilename(scan.domain, scan.scannedAt, "md"), text, "text/markdown;charset=utf-8");
    }
  }

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
</div>
