"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "../ui";

/** One row of the composer's completion list. `key` is what the pane acts on; the rest is what the
 *  reader sees. */
export interface CompletionRow {
  key: string;
  /** The thing itself: `/brainstorming`, or `src/core/conversation.ts`. */
  label: string;
  /** What it is, when there is something worth saying — a command's description, and nothing for a
   *  file, whose path already says it. */
  hint?: string;
  /** A short right-hand tag: where a command came from. */
  right?: string;
}

export interface CompletionMenuProps {
  /** The list's name for a screen reader (the pane passes its translated string). */
  label: string;
  rows: readonly CompletionRow[];
  /** Which row Enter would take. Kept by the pane, because the keys that move it are caught on the
   *  composer, not here. */
  active: number;
  onPick: (row: CompletionRow) => void;
  onHover: (index: number) => void;
  /** A line under the rows saying the list is still being built (the `@` index's first walk). With it
   *  the menu is drawn even with no rows yet, so a slow walk reads as work under way, not as nothing. */
  status?: string;
  /** Whether the status line is work under way (a spinner beside it). False for a line that only
   *  says something, such as the file list being unavailable. Defaults to true. */
  statusBusy?: boolean;
}

/** The list `/` and `@` open, drawn in the banner slot so it sits directly above the composer with no
 *  positioning of its own. */
export function CompletionMenu({
  label,
  rows,
  active,
  onPick,
  onHover,
  status,
  statusBusy = true,
}: CompletionMenuProps): ReactNode {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // Arrowing past the bottom of a long list has to bring the row with it.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Not a listbox: focus stays in the composer the whole time (the keys that move `active` are caught
  // there), so the rows are mouse targets and the active one is read out through the live line below.
  // shortcut: a hand-rolled composer autocomplete; a ui Combobox primitive is the proper home for it.
  return (
    <div
      role="group"
      aria-label={label}
      data-slot="conversation-completion-menu"
      className="border-border/60 bg-card max-h-64 overflow-y-auto rounded-(--composer-radius) border py-1 text-sm"
    >
      {rows.map((row, i) => (
        <Button
          key={row.key}
          ref={i === active ? activeRef : undefined}
          variant="ghost"
          tabIndex={-1}
          aria-current={i === active ? "true" : undefined}
          // `*:flex-1` lets the Button's label span take the row, so the right tag sits at the edge.
          className={`w-full *:flex-1 ${i === active ? "is-active" : ""}`}
          // Chosen on mousedown, not click: a click would first move focus off the composer, and the
          // composer losing focus is what closes this.
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(row);
          }}
          onMouseEnter={() => onHover(i)}
        >
          <span className="flex items-baseline gap-2 text-left">
            <span className="text-foreground shrink-0 font-medium">{row.label}</span>
            {row.hint !== undefined && (
              <span className="min-w-0 flex-1 truncate text-xs">{row.hint}</span>
            )}
            {row.right !== undefined && (
              <span className="ms-auto shrink-0 text-xs opacity-60">{row.right}</span>
            )}
          </span>
        </Button>
      ))}
      <div aria-live="polite" className="sr-only">
        {rows[active]?.label}
      </div>
      {status !== undefined && (
        <div
          role="status"
          className="text-muted-foreground flex items-center gap-2 px-3 py-1.5 text-xs"
        >
          {statusBusy && <span className="loading-spinner small" aria-hidden="true" />}
          {status}
        </div>
      )}
    </div>
  );
}
