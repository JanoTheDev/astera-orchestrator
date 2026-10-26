import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { MAX_CONCURRENT_WORKERS } from "../../../core/orchestration/types";
import type { MachineSpecs } from "../../../core/types";
import { toast } from "../lib/toast";
import { Input } from "./ui";
import { SettingItem } from "./settings/SettingItem";
import { AutoLimitHint } from "./AutoLimitHint";

/** The app-wide Job worker cap (orchestrator W1-B). Empty uses the machine recommendation, at most 100 (W6-C). Saved on blur, so typing "12" does not save "1" on
 *  the way; a value that is not a whole number of 1 or more goes back to what was saved. */
export function MaxWorkersSetting(): React.JSX.Element {
  const { t } = useI18n();
  const [saved, setSaved] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [specs, setSpecs] = useState<MachineSpecs | null>(null);

  useEffect(() => {
    void window.api.settings.getMaxConcurrentWorkers().then((n) => {
      setSaved(n);
      setDraft(n === null ? "" : String(n));
    });
    void window.api.settings.getMachineSpecs().then(setSpecs);
  }, []);

  const commit = (): void => {
    const n = draft.trim() === "" ? null : Number(draft);
    if (n !== null && (!Number.isInteger(n) || n < 1)) {
      setDraft(saved === null ? "" : String(saved));
      return;
    }
    if (n === saved) return;
    setSaved(n);
    void window.api.settings.setMaxConcurrentWorkers(n).catch((err) => {
      setSaved(saved);
      setDraft(saved === null ? "" : String(saved));
      toast.error(
        t("settings.maxWorkers.saveFailed", {
          detail: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  };

  return (
    <SettingItem
      title={t("settings.maxWorkers.label")}
      hint={t("settings.maxWorkers.hint")}
      control={
        <Input
          type="number"
          min={1}
          max={MAX_CONCURRENT_WORKERS}
          placeholder={specs ? String(specs.recommended) : undefined}
          value={draft}
          aria-label={t("settings.maxWorkers.label")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      }
    >
      {specs && (
        <span className="settings-hint">
          {t("settings.maxWorkers.recommended", {
            count: specs.recommended,
            memory: Math.round(specs.totalMemBytes / 1024 ** 3),
            cores: specs.logicalCpus,
          })}
        </span>
      )}
      <AutoLimitHint kind="workers" />
      {specs && Number(draft) > specs.recommended && (
        <span className="settings-hint" role="alert">
          {t("settings.maxWorkers.overRecommended", {
            count: specs.recommended,
          })}
        </span>
      )}
    </SettingItem>
  );
}
