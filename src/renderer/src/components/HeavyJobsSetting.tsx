import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { toast } from "../lib/toast";
import { Input } from "./ui";
import { SettingItem } from "./settings/SettingItem";
import { AutoLimitHint } from "./AutoLimitHint";

// shortcut: copy of HEAVY_JOBS_MAX (core/settings/heavyJobs.ts, which imports node:fs and is outside tsconfig.web); main clamps anyway.
const HEAVY_JOBS_MAX = 8;

/** How many heavy jobs the machine runs at once (core/settings/heavyJobs.ts). Saved on blur, as MaxWorkersSetting is;
 *  a value that is not a whole number from 1 to HEAVY_JOBS_MAX goes back to what was saved. */
export function HeavyJobsSetting(): React.JSX.Element {
  const { t } = useI18n();
  const [saved, setSaved] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    void window.api.settings.getHeavyJobsAtOnce().then((n) => {
      setSaved(n);
      setDraft(String(n));
    });
  }, []);

  const commit = (): void => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isInteger(n) || n < 1 || n > HEAVY_JOBS_MAX) {
      setDraft(saved === null ? "" : String(saved));
      return;
    }
    if (n === saved) return;
    const was = saved;
    setSaved(n);
    void window.api.settings.setHeavyJobsAtOnce(n).catch((err) => {
      setSaved(was);
      setDraft(was === null ? "" : String(was));
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
          disabled={saved === null}
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
