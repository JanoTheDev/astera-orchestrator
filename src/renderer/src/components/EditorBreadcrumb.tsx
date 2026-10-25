import { Fragment, useState } from "react";
import { foldPathCase } from "../../../core/files/paths";
import { resolveFileIcon } from "../../../core/files/icons";
import { useI18n } from "../i18n/I18nProvider";
import { FileIcon } from "./FileIcon";
import { isMac } from "../lib/platformKeys";
import { toast } from "../lib/toast";
import { Icon, Menu, menuPointOf, type MenuItem } from "./ui";

/** The path segments of `path`, relative to `root` when it lies inside it (the whole path otherwise). */
export function crumbsOf(path: string, root?: string): string[] {
  const parts = (p: string): string[] => p.split(/[\\/]+/).filter(Boolean);
  const all = parts(path);
  if (!root) return all;
  const base = parts(root);
  const inside =
    base.length < all.length &&
    base.every((seg, i) => foldPathCase(seg) === foldPathCase(all[i]));
  return inside ? all.slice(base.length) : all;
}

/** `path` relative to `root` with '/' separators, or null when it lies outside `root` (or there is none). */
export function relativePathOf(path: string, root?: string): string | null {
  if (!root) return null;
  const rel = crumbsOf(path, root);
  const total = path.split(/[\\/]+/).filter(Boolean).length;
  return rel.length < total ? rel.join("/") : null;
}

/** The header line above an open file (VSCode's breadcrumbs): folders dim, the file name bright with its icon. */
export function EditorBreadcrumb({
  path,
  root,
}: {
  path: string;
  root?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const segs = crumbsOf(path, root);
  const name = segs[segs.length - 1] ?? path;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const relative = relativePathOf(path, root);
  const items: Array<MenuItem | "separator"> = [
    {
      label: t("explorer.menu.copyPath"),
      onSelect: () => window.api.clipboard.writeText(path),
    },
    {
      label: t("explorer.menu.copyRelativePath"),
      disabled: relative === null,
      onSelect: () => window.api.clipboard.writeText(relative ?? path),
    },
    "separator",
    {
      label: t(isMac() ? "explorer.menu.revealMac" : "explorer.menu.reveal"),
      onSelect: () =>
        void window.api.files.reveal(path).catch((err: unknown) => {
          toast.error(
            t("explorer.reveal.failed", {
              detail: err instanceof Error ? err.message : String(err),
            }),
          );
        }),
    },
  ];
  return (
    <>
      <nav
        className="editor-crumbs"
        aria-label={t("files.editor.breadcrumb")}
        title={path}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu(menuPointOf(e));
        }}
      >
        {segs.slice(0, -1).map((seg, i) => (
          <Fragment key={i}>
            <span className="editor-crumb">{seg}</span>
            <Icon name="chevronRight" size={14} className="editor-crumb-sep" />
          </Fragment>
        ))}
        <span className="editor-crumb editor-crumb-file" aria-current="page">
          <FileIcon {...resolveFileIcon(name)} />
          {name}
        </span>
      </nav>
      {menu && (
        <Menu
          at={menu}
          label={t("files.editor.breadcrumb")}
          items={items}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
