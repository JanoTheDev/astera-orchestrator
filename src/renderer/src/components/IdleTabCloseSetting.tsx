import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { toast } from "../lib/toast";
import { Input } from "./ui";
import { SettingItem } from "./settings/SettingItem";

const MIN = 1;
const MAX = 60;

/** Minutes an Astera-started tab with nothing left to do may idle before it is closed (core/settings/idleTabClose.ts).
 *  Saved on blur, as FreshCoordinatorSetting is; a value that is not a whole number from 1 to 60 goes back to what was
 *  saved. */
export function IdleTabCloseSetting(): React.JSX.Element {
  const { t } = useI18n();
  const [saved, setSaved] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    void window.api.settings.getIdleTabCloseMinutes().then((n) => {
      setSaved(n);
      setDraft(String(n));
    });
  }, []);

  const commit = (): void => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isInteger(n) || n < MIN || n > MAX) {
      setDraft(saved === null ? "" : String(saved));
      return;
    }
    if (n === saved) return;
    const was = saved;
    setSaved(n);
    void window.api.settings.setIdleTabCloseMinutes(n).catch((err) => {
      setSaved(was);
      setDraft(was === null ? "" : String(was));
      toast.error(
        t("settings.idleTabClose.saveFailed", {
          detail: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  };

  return (
    <SettingItem
      title={t("settings.idleTabClose.label")}
      hint={t("settings.idleTabClose.hint")}
      control={
        <Input
          type="number"
          min={MIN}
          max={MAX}
          value={draft}
          disabled={saved === null}
          aria-label={t("settings.idleTabClose.label")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      }
    />
  );
}
