import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronRight } from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider";
import {
  cx,
  paneResize,
  readPaneSize,
  readSectionOpen,
  writePaneSize,
  writeSectionOpen,
} from "./logic";
import { Badge } from "./Badge";
import { Sash } from "./Sash";
import { useOpenClose } from "./motion";

/** A pane keeps its header plus one row (--row-h each, 22px) when a sash squeezes it. */
const PANE_MIN_H = 44;

type PaneEntry = {
  weight: number | null;
  set: (weight: number, persist: boolean) => void;
};
type Container = {
  panes: React.RefObject<Map<string, PaneEntry>>;
  resize: (id: string, px: number, persist: boolean) => void;
  mean: () => number | undefined;
};
const ContainerContext = createContext<Container | null>(null);

function storage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export type ViewPaneProps = {
  title: React.ReactNode;
  /** A count badge after the title; hidden when undefined. */
  count?: number;
  /** Header actions (sm `IconButton`s or a `Toolbar`), shown on hover or focus-within. */
  actions?: React.ReactNode;
  /** Persists the expanded state under `cm.section.<storageKey>`; without it the state lives in memory. */
  storageKey?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
  className?: string;
};

/** A collapsible side-bar section (DESIGN-W13 §12): a 22px header with twistie, uppercase title, count and hover
 *  actions, then a body that scrolls. Stack them in a `ViewContainer`, which shares the height among the open ones. */
export function ViewPane({
  title,
  count,
  actions,
  storageKey,
  defaultExpanded = true,
  children,
  className,
}: ViewPaneProps): React.JSX.Element {
  const [open, setOpen] = useState(() =>
    storageKey
      ? readSectionOpen(storage(), storageKey, defaultExpanded)
      : defaultExpanded,
  );
  const bodyId = useId();
  const autoId = useId();
  const id = storageKey ?? autoId;
  const container = useContext(ContainerContext);
  const { t } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const [weight, setWeight] = useState<number | null>(() =>
    storageKey ? (readPaneSize(storage(), storageKey) ?? null) : null,
  );
  const [height, setHeight] = useState(0);
  const set = useCallback(
    (w: number, persist: boolean) => {
      setWeight(w);
      if (persist && storageKey) writePaneSize(storage(), storageKey, w);
    },
    [storageKey],
  );
  useLayoutEffect(() => {
    const panes = container?.panes.current;
    panes?.set(id, { weight, set });
    return () => void panes?.delete(id);
  }, [container, id, weight, set]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !open) return;
    const measure = (): void => setHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);
  const prevOpen = open ? previousOpenPane(ref.current) : null;
  const sashMax = Math.max(
    PANE_MIN_H,
    height + (prevOpen?.offsetHeight ?? 0) - PANE_MIN_H,
  );
  const grow = open ? (weight ?? container?.mean()) : undefined;
  const toggle = (): void => {
    setOpen(!open);
    if (storageKey) writeSectionOpen(storage(), storageKey, !open);
  };
  return (
    <section
      ref={ref}
      data-pane={id}
      className={cx("ui-viewpane", open && "is-open", className)}
      // an explicit size wins over a pane's own CSS flex and max-height
      style={
        grow === undefined
          ? undefined
          : { flex: `${grow} 1 0`, maxHeight: "none" }
      }
    >
      {open && container && (
        <Sash
          orientation="horizontal"
          reverse
          size={height}
          min={PANE_MIN_H}
          max={sashMax}
          label={t("shell.viewpane.resize")}
          className="ui-viewpane__sash"
          onResize={(px) => container.resize(id, px, false)}
          onResizeEnd={(px) => container.resize(id, px, true)}
        />
      )}
      <div className="ui-viewpane__head">
        <button
          type="button"
          className="ui-viewpane__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggle}
        >
          <ChevronRight
            size={16}
            className="ui-viewpane__twistie"
            aria-hidden="true"
          />
          <span className="ui-viewpane__title">{title}</span>
          {count !== undefined && (
            <Badge className="ui-viewpane__count">{count}</Badge>
          )}
        </button>
        {actions && <div className="ui-viewpane__actions">{actions}</div>}
      </div>
      {open && <ViewPaneBody id={bodyId}>{children}</ViewPaneBody>}
    </section>
  );
}

function ViewPaneBody({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useOpenClose(ref, "height");
  return (
    <div id={id} ref={ref} className="ui-viewpane__body">
      {children}
    </div>
  );
}

function previousOpenPane(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.previousElementSibling; p; p = p.previousElementSibling)
    if (p.classList.contains("is-open")) return p as HTMLElement;
  return null;
}

/** The column of `ViewPane`s in a side-bar view: open panes split the height, closed ones keep only their header. */
export function ViewContainer({
  children,
  className,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label?: string;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const panes = useRef(new Map<string, PaneEntry>());
  const value = useMemo<Container>(
    () => ({
      panes,
      // the sash above pane `id` moved it to `px`: every open pane takes its pixel height as weight, the pair trades
      resize: (id, px, persist) => {
        const els = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            ":scope > .ui-viewpane.is-open",
          ) ?? []),
        ];
        const i = els.findIndex((el) => el.dataset.pane === id);
        const next = paneResize(
          els.map((el) => el.offsetHeight),
          i,
          px,
          PANE_MIN_H,
        );
        els.forEach((el, j) =>
          panes.current.get(el.dataset.pane ?? "")?.set(next[j], persist),
        );
      },
      // a pane without a saved size (just opened) joins at the average of the others
      mean: () => {
        const w = [...panes.current.values()].flatMap((p) =>
          p.weight === null ? [] : [p.weight],
        );
        return w.length ? w.reduce((a, b) => a + b, 0) / w.length : undefined;
      },
    }),
    [],
  );
  return (
    <ContainerContext.Provider value={value}>
      <div
        ref={ref}
        className={cx("ui-viewcontainer", className)}
        aria-label={label}
      >
        {children}
      </div>
    </ContainerContext.Provider>
  );
}
