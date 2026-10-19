// W6-A intake: the files a person attaches to a Job, copied into `<profile>/plans/<jobId>/inputs/`, beside the Job's
// plan.md. Every session may read `<profile>/plans` without a prompt (`--add-dir`, as the spec folder): the planner
// reads the files there with Claude's own reader, which reads PDFs. Astera parses nothing.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { planFileOf } from './planner'

/** Larger files are refused: the path comes from the UI or the CLI, and a planner reads the file whole. */
export const INTAKE_FILE_MAX_BYTES = 30 * 1024 * 1024

/** `<profile>/plans`: the folder sessions may read (plan.md files and the Jobs' inputs; no tokens). */
export const plansDirOf = (profileDir: string): string => path.join(profileDir, 'plans')

export const inputsDirOf = (profileDir: string, jobId: string): string => path.join(path.dirname(planFileOf(profileDir, jobId)), 'inputs')

/** Checks every file first, then creates the Job's inputs folder and copies them in. Throws the sentence to answer
 *  with when one is refused, before anything is copied. Called with no files, it only creates the folder (an audit's
 *  findings go there). */
export async function copyIntakeFiles(profileDir: string, jobId: string, files: readonly string[]): Promise<{ dir: string; names: string[] }> {
  const names: string[] = []
  for (const f of files) {
    if (!path.isAbsolute(f)) throw new Error(`${f}: give an absolute path`)
    const st = await fs.stat(f).catch(() => null)
    if (st === null) throw new Error(`${f}: no such file`)
    if (!st.isFile()) throw new Error(`${f}: not a regular file`)
    if (st.size > INTAKE_FILE_MAX_BYTES) throw new Error(`${f}: larger than ${INTAKE_FILE_MAX_BYTES / 1024 / 1024} MB`)
    const name = path.basename(f)
    if (names.includes(name)) throw new Error(`two attachments are named ${name}; rename one`)
    names.push(name)
  }
  const dir = inputsDirOf(profileDir, jobId)
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  for (let k = 0; k < files.length; k++) await fs.copyFile(files[k], path.join(dir, names[k]))
  return { dir, names }
}

/** #119: writes `text` as the file `name` of the Job's inputs folder (creating the folder) and answers its path. Astera's
 *  own record (inputs/pick.md), never a person's file. */
export async function writeIntakeText(profileDir: string, jobId: string, name: string, text: string): Promise<string> {
  if (path.basename(name) !== name || name.startsWith('.')) throw new Error(`${name}: not a file name`)
  const dir = inputsDirOf(profileDir, jobId)
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, name)
  await fs.writeFile(file, text, { encoding: 'utf8', mode: 0o600 })
  return file
}

// W8-C prompts mode
/** A text file's content, or null when it is not there (a project with no docs/dev/PLAN.md). */
export async function readTextIfAny(file: string): Promise<string | null> {
  return fs.readFile(file, 'utf8').catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return null
    throw e
  })
}

// W10-A Run as written by name
/** The `.md` files under `dir`, `/`-separated and relative to it, at most `depth` folders down (0: its own files);
 *  [] when `dir` is not there. Hidden folders and node_modules are not entered. */
export async function listMdFiles(dir: string, depth: number): Promise<string[]> {
  const out: string[] = []
  const walk = async (rel: string, left: number): Promise<void> => {
    const entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      const name = rel === '' ? e.name : `${rel}/${e.name}`
      if (e.isFile() && e.name.endsWith('.md')) out.push(name)
      else if (e.isDirectory() && left > 0 && !e.name.startsWith('.') && e.name !== 'node_modules') await walk(name, left - 1)
    }
  }
  await walk('', depth)
  return out.sort()
}
