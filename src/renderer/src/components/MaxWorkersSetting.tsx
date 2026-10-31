import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { MAX_CONCURRENT_WORKERS } from "../../../core/orchestration/types";
import type { AgentLimits, MachineSpecs } from "../../../core/types";
import { toast } from "../lib/toast";
import { Button, Input } from "./ui";
import { SettingItem } from "./settings/SettingItem";
import { aboveRecommendedNote, effectiveLimitNote } from "./autoLimitNote";

const REFRESH_MS = 10_000;

/** The limits in force, re-read every 10 s while the page is open (a cheap IPC read) and on demand after a save or a restore. */
function useAgentLimits(): { limits: AgentLimits | null; refresh: () => void } {
  const [limits, setLimits] = useState<AgentLimits | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const read = (): void =>
      void window.api.settings.agentLimits().then(
        (l) => live && setLimits(l),
        () => {},
      );
    read();
    const id = setInterval(read, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [tick]);
  return { limits, refresh: useCallback(() => setTick((n) => n + 1), []) };
}

/** The app-wide Job worker cap (orchestrator W1-B). Empty uses the machine recommendation, at most 100 (W6-C). Saved on blur, so typing "12" does not save "1" on
 *  the way; a value that is not a whole number of 1 or more goes back to what was saved. A value above the recommendation is saved
 *  and explained, not warned about. While Astera holds the limit lower (T7), the row says which limit is in force and why. */
export function MaxWorkersSetting(): React.JSX.Element {
  const { t } = useI18n();
  const [saved, setSaved] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [specs, setSpecs] = useState<MachineSpecs | null>(null);
  const { limits, refresh } = useAgentLimits();

  useEffect(() => {
    void window.api.settings.getMachineSpecs().then(setSpecs);
    void window.api.settings.getMaxConcurrentWorkers().then((n) => {
      setSaved(n);
      setDraft(n === null ? "" : String(n));
    });
  }, []);

  const commit = (): void => {
    const n = draft.trim() === "" ? null : Number(draft);
    if (n !== null && (!Number.isInteger(n) || n < 1)) {
      setDraft(saved === null ? "" : String(saved));
      return;
    }
    if (n === saved) return;
    setSaved(n);
    void window.api.settings
      .setMaxConcurrentWorkers(n)
      .then(refresh)
      .catch((err) => {
        setSaved(saved);
        setDraft(saved === null ? "" : String(saved));
        toast.error(
          t("settings.maxWorkers.saveFailed", {
            detail: err instanceof Error ? err.message : String(err),
          }),
        );
      });
  };

  const restore = (): void => {
    window.api.settings.restoreAutoLimit("workers").then(refresh, (err) =>
      toast.error(
        t("settings.autoLimit.restoreFailed", {
          detail: err instanceof Error ? err.message : String(err),
        }),
      ),
    );
  };

  // What the field would hold once saved: the typed number when it is a valid one, else the saved limit.
  const typed = draft.trim() === "" ? null : Number(draft);
  const shown = limits && typed !== null && Number.isInteger(typed) && typed >= 1 ? { ...limits, person: Math.min(typed, MAX_CONCURRENT_WORKERS) } : limits;
  const above = shown ? aboveRecommendedNote(shown, t) : null;
  const lowered = limits ? effectiveLimitNote(limits, t) : null;

  return (
    <>
      <SettingItem
        title={t("settings.maxWorkers.label")}
        hint={t("settings.maxWorkers.hint")}
        control={
          <Input
            type="number"
            min={1}
            max={MAX_CONCURRENT_WORKERS}
            placeholder={limits ? String(limits.recommended) : undefined}
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
        {above && <span className="settings-hint">{above}</span>}
        {lowered && limits && (
          <span className="settings-hint">
            {lowered}{" "}
            <Button size="sm" onClick={restore}>
              {t("settings.autoLimit.restoreTo", { count: limits.person })}
            </Button>
          </span>
        )}
      </SettingItem>
      <MinWorkersSetting limits={limits} onSaved={refresh} />
    </>
  );
}

/** "Minimum agents under memory pressure": key minWorkersUnderPressure. Empty is the default, half the owner's limit,
 *  shown as the placeholder. Saved on blur like the limit above. */
function MinWorkersSetting({ limits, onSaved }: { limits: AgentLimits | null; onSaved: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const [saved, setSaved] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    void window.api.settings.getMinWorkersUnderPressure().then((n) => {
      setSaved(n);
      setDraft(n === null ? "" : String(n));
    });
  }, []);

  const commit = (): void => {
    const n = draft.trim() === "" ? null : Number(draft);
    if (n !== null && (!Number.isInteger(n) || n < 1)) {
      setDraft(saved === null ? "" : String(saved));
      return;
    }
    if (n === saved) return;
    setSaved(n);
    void window.api.settings
      .setMinWorkersUnderPressure(n)
      .then(async () => {
        // The main side keeps a value at most the owner's limit; show what was kept.
        const kept = await window.api.settings.getMinWorkersUnderPressure();
        setSaved(kept);
        setDraft(kept === null ? "" : String(kept));
        onSaved();
      })
      .catch((err) => {
        setSaved(saved);
        setDraft(saved === null ? "" : String(saved));
        toast.error(
          t("settings.minWorkers.saveFailed", {
            detail: err instanceof Error ? err.message : String(err),
          }),
        );
      });
  };

  return (
    <SettingItem
      title={t("settings.minWorkers.label")}
      hint={t("settings.minWorkers.hint")}
      control={
        <Input
          type="number"
          min={1}
          max={limits?.person ?? MAX_CONCURRENT_WORKERS}
          placeholder={
            limits
              ? t("settings.minWorkers.default", {
                  count: limits.minUnderPressure.isDefault ? limits.minUnderPressure.value : Math.max(1, Math.ceil(limits.person / 2)),
                  person: limits.person,
                })
              : undefined
          }
          value={draft}
          aria-label={t("settings.minWorkers.label")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      }
    />
  );
}
