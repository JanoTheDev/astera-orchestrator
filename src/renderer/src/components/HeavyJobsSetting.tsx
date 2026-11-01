import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { toast } from "../lib/toast";
import { Input } from "./ui";
import { SettingItem } from "./settings/SettingItem";
import { AutoLimitHint } from "./AutoLimitHint";

// shortcut: copy of HEAVY_JOBS_MAX (core/settings/heavyJobs.ts, which imports node:fs and is outside tsconfig.web); main clamps anyway.
const HEAVY_JOBS_MAX = 8;

/** How many heavy jobs the machine runs at once (core/settings/heavyJobs.ts). Empty is Auto, sized from free memory
 *  (the placeholder says what it is now); a number is used as is. Saved on blur, as MaxWorkersSetting is; a value that is
 *  not empty or a whole number from 1 to HEAVY_JOBS_MAX goes back to what was saved. */
export function HeavyJobsSetting(): React.JSX.Element {
  const { t } = useI18n();
  // undefined until read; "auto" or the owner's number after
  const [saved, setSaved] = useState<number | "auto" | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [autoNow, setAutoNow] = useState<number | null>(null);

  useEffect(() => {
    void window.api.settings.getHeavyJobsAtOnce().then((n) => {
      setSaved(n);
      setDraft(n === "auto" ? "" : String(n));
    });
    const read = (): void => void window.api.settings.getAutoHeavySlots().then(setAutoNow, () => {});
    read();
    const id = setInterval(read, 30_000);
    return () => clearInterval(id);
  }, []);

  const commit = (): void => {
    const n: number | "auto" = draft.trim() === "" ? "auto" : Number(draft);
    if (n !== "auto" && (!Number.isInteger(n) || n < 1 || n > HEAVY_JOBS_MAX)) {
      setDraft(saved === undefined || saved === "auto" ? "" : String(saved));
      return;
    }
    if (n === saved) return;
    const was = saved;
    setSaved(n);
    void window.api.settings.setHeavyJobsAtOnce(n).catch((err) => {
      setSaved(was);
      setDraft(was === undefined || was === "auto" ? "" : String(was));
      toast.error(
        t("settings.heavyJobs.saveFailed", {
          detail: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  };

  return (
    <SettingItem
      title={t("settings.heavyJobs.label")}
      hint={t("settings.heavyJobs.hint")}
      control={
        <Input
          type="number"
          min={1}
          max={HEAVY_JOBS_MAX}
          value={draft}
          disabled={saved === undefined}
          placeholder={t("settings.heavyJobs.auto", { count: autoNow ?? "…" })}
          aria-label={t("settings.heavyJobs.label")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      }
    >
      <AutoLimitHint kind="heavy" />
    </SettingItem>
  );
}
