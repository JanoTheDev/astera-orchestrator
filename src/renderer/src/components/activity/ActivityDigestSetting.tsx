import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { toast } from "../../lib/toast";
import { Input } from "../ui";
import { SettingItem } from "../settings/SettingItem";

/** W3-A: minutes between activity digests (core/settings/activityDigest.ts), 0 for none. Saved on blur, as
 *  MaxWorkersSetting is; a value that is not a whole number from 0 to a day goes back to what was saved. */
export function ActivityDigestSetting(): React.JSX.Element {
  const { t } = useI18n();
  const [saved, setSaved] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    void window.api.settings.getActivityDigestMinutes().then((n) => {
      setSaved(n);
      setDraft(String(n));
    });
  }, []);

  const commit = (): void => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isInteger(n) || n < 0 || n > 1440) {
      setDraft(saved === null ? "" : String(saved));
      return;
    }
    if (n === saved) return;
    const was = saved;
    setSaved(n);
    void window.api.settings.setActivityDigestMinutes(n).catch((err) => {
      setSaved(was);
      setDraft(was === null ? "" : String(was));
      toast.error(
        t("settings.activityDigest.saveFailed", {
          detail: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  };

  return (
    <SettingItem
      title={t("settings.activityDigest.label")}
      hint={t("settings.activityDigest.hint")}
      control={
        <Input
          type="number"
          min={0}
          max={1440}
          value={draft}
          disabled={saved === null}
          aria-label={t("settings.activityDigest.label")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      }
    />
  );
}
