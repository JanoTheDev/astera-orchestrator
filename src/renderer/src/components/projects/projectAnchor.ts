/** W8-G (#104): the folder project commands are sent from. The open project, else the first tab's folder, else the home
 *  folder, which the app may always name (`assertOrchPath`): a window with no tab can still make its first project. */
export const projectAnchorOf = (currentProject: string | null, firstTabCwd: string | undefined, home: string | null): string | null =>
  currentProject ?? firstTabCwd ?? home
