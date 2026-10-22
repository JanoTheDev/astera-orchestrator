import {
  Activity, AlertTriangle, Archive, ArchiveRestore, ArrowLeft, ArrowUpRight, Bell, Check, ChevronDown, ChevronRight, ChevronUp,
  Circle, CircleCheck, Copy, ExternalLink, Eye, EyeOff, FileText, FolderGit2, FolderOpen, FolderPlus, GitBranch, GitMerge,
  GitPullRequest, Globe, History, Inbox, Info, Layers, ListTodo, Loader2, Lock, MessageSquare, Minus, MoreHorizontal, Pencil, Play,
  Plus, RefreshCw, Save, Search, Settings, SlidersHorizontal, Square, SquareTerminal, Trash2, Users, X, XCircle, type LucideIcon
} from 'lucide-react'

export type IconSize = 14 | 16 | 20

/** The named icons: one lucide glyph per meaning, so the same action looks the same on every screen. Add a name here
 *  before using a new glyph on a page; only these are bundled through the registry. */
export const ICONS = {
  activity: Activity,
  add: Plus,
  archive: Archive,
  back: ArrowLeft,
  branch: GitBranch,
  check: Check,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  chevronUp: ChevronUp,
  close: X,
  copy: Copy,
  delete: Trash2,
  done: CircleCheck,
  edit: Pencil,
  error: XCircle,
  external: ExternalLink,
  file: FileText,
  filter: SlidersHorizontal,
  folder: FolderOpen,
  folderAdd: FolderPlus,
  hide: EyeOff,
  history: History,
  inbox: Inbox,
  info: Info,
  layers: Layers,
  loading: Loader2,
  lock: Lock,
  merge: GitMerge,
  message: MessageSquare,
  more: MoreHorizontal,
  notifications: Bell,
  open: ArrowUpRight,
  pending: Circle,
  pullRequest: GitPullRequest,
  refresh: RefreshCw,
  remove: Minus,
  repo: FolderGit2,
  restore: ArchiveRestore,
  run: Play,
  save: Save,
  search: Search,
  settings: Settings,
  show: Eye,
  stop: Square,
  tasks: ListTodo,
  terminal: SquareTerminal,
  users: Users,
  warning: AlertTriangle,
  web: Globe
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS

/** A lucide icon, by registry `name` (preferred) or by the imported component (`icon`, for a glyph not in the registry yet).
 *  16px in controls and rows, 14px in dense bars and chips. Decorative unless `label` is given. */
export function Icon({
  icon,
  name,
  size = 16,
  label,
  className
}: ({ icon: LucideIcon; name?: undefined } | { name: IconName; icon?: undefined }) & { size?: IconSize; label?: string; className?: string }): React.JSX.Element {
  const Glyph = icon ?? ICONS[name as IconName]
  return label ? (
    <Glyph size={size} className={className} role="img" aria-label={label} />
  ) : (
    <Glyph size={size} className={className} aria-hidden="true" />
  )
}
