// Moved out of App.tsx unchanged (W9-A).
import { type RecordTab } from '../components/WorkbenchTabs'

/** The key a record tab's narrowed-flow-step memory (scopedNode) uses. Carries both the project and
 *  the record — a tab id (`record:<id>`) has no project in it, so two projects sharing a record id
 *  would otherwise leak each other's scoping. Kept in one place so the reader, the writer and the
 *  deleter all build the same string. */
export const scopeKey = (rec: RecordTab): string => `${rec.projectRoot}::${rec.recordId}`
