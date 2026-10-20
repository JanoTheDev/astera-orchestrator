// T14 Coordinator strip: the project's live plans side by side (scrolls sideways), each with its state, wave, workers
// and what it waits on. A card opens its plan. The cards are coordinator.ts'.
import { Users } from "lucide-react";
import type { JobRow } from "../../../../core/types";
import { useI18n } from "../../i18n/I18nProvider";
import { Card, Chip, Icon } from "../ui";
import { coordinatorOf, type CoordWait } from "./coordinator";

export function Coordinator({
  rows,
  onOpen,
}: {
  rows: readonly JobRow[];
  onOpen: (id: string) => void;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const cards = coordinatorOf(rows);
  if (cards.length < 1) return null;
  const waitText = (w: CoordWait): string =>
    w.kind === "lease"
      ? t("pages.plans.lease", { plan: w.plan })
      : w.kind === "after"
        ? t(
            w.stopped ? "pages.plans.afterStopped" : "pages.plans.startsAfter",
            { plan: w.plan },
          )
        : w.plan !== undefined
          ? t("pages.plans.overlaps", { plan: w.plan })
          : t("jobs.run.overlaps");
  return (
    <section className="plans-coord" aria-labelledby="plans-coord-title">
      <h2 id="plans-coord-title" className="plans-coord__title">
        {t("pages.plans.coordinator")}
      </h2>
      <div className="plans-coord__cards">
        {cards.map((c) => (
          <Card
            key={c.id}
            className="plans-coord__card"
            tone={c.waits.length > 0 ? "need" : "plain"}
            onClick={() => onOpen(c.id)}
          >
            <span className="plans-coord__name" title={c.name}>
              {c.name}
            </span>
            <span className="plans-coord__facts">
              <Chip tone={c.status.tone} dot>
                {t(c.status.key)}
              </Chip>
              {c.status.reason !== undefined && <span title={c.status.reason}>{t('jobs.run.notDelivered', { reason: c.status.reason })}</span>}
              {c.wave && (
                <span>
                  {t("pages.plans.wave", { at: c.wave.at, of: c.wave.of })}
                </span>
              )}
              <span className="plans-coord__workers">
                <Icon icon={Users} size={14} />
                {t("pages.plans.workers", { n: c.workers })}
              </span>
            </span>
            {c.waits.length === 0 ? (
              <span className="plans-coord__wait plans-coord__wait--none">
                {t("pages.plans.noWait")}
              </span>
            ) : (
              c.waits.map((w, i) => (
                <span
                  key={i}
                  className={`plans-coord__wait plans-coord__wait--${w.kind}`}
                  title={
                    w.kind === "lease"
                      ? w.path
                      : w.kind === "overlap"
                        ? w.lines.join("\n")
                        : undefined
                  }
                >
                  {waitText(w)}
                </span>
              ))
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}
