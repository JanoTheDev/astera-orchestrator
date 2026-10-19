// W2-A: the planner takes the coordinator's start path, with its own brief, model role, title and no bypass.
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startCoordinatorSession, type CoordinatorStartContext } from './workerStart'
import { plannerBriefName } from './plannerStart'
import { createJob, emptyState } from '../state'
import type { Account } from '../../types'

const account = { id: 'acc1', label: 'a', provider: 'claude', configDir: '/x' } as unknown as Account

describe('startCoordinatorSession with role planner', () => {
  it('starts the planner on the planner model, never with the bypass, and writes its brief', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-planner-'))
    try {
      const job = createJob(emptyState(), { objective: 'add a login page', cwd: '/repo', pendingStart: true }, '2026-10-17T00:00:00.000Z')
      if (!job.ok) throw new Error(job.error)
      const spawned: Array<Record<string, unknown>> = []
      const ctx: CoordinatorStartContext = {
        specsDir: dir,
        preTrust: async () => {},
        // The owner turned the bypass on: a planner still never gets it.
        bypassPermissions: async () => true,
        spawn: async (o) => {
          spawned.push(o)
          return { id: 'ses-planner' }
        },
        log: () => {},
        getState: () => job.state,
        accounts: async () => [account],
        roleModels: async () => ({})
      }
      const r = await startCoordinatorSession(ctx, { runId: job.value.id, cwd: '/repo', accountId: 'acc1', brief: 'PLAN IT', role: 'planner' })
      expect(r).toEqual({ sessionId: 'ses-planner' })
      expect(spawned[0]).toMatchObject({ accountId: 'acc1', cwd: '/repo', bypassPermissions: false, model: 'opus', rollAccountIds: ['acc1'], title: 'Planner · add a login page' })
      const briefPath = path.join(dir, plannerBriefName(job.value.id))
      expect(await fs.readFile(briefPath, 'utf8')).toBe('PLAN IT')
      expect(spawned[0].initialPrompt).toContain(briefPath.replace(/\\/g, '/'))
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it("#117: a hands-off Job's planner starts with the bypass, by the owner's choice", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-planner-'))
    try {
      const job = createJob(emptyState(), { objective: 'o', cwd: '/repo', pendingStart: true }, '2026-10-17T00:00:00.000Z')
      if (!job.ok) throw new Error(job.error)
      const state = { ...job.state, jobs: job.state.jobs.map((j) => ({ ...j, handsOff: true })) }
      const spawned: Array<Record<string, unknown>> = []
      const ctx: CoordinatorStartContext = {
        specsDir: dir,
        preTrust: async () => {},
        bypassPermissions: async () => false,
        spawn: async (o) => {
          spawned.push(o)
          return { id: 'ses-planner' }
        },
        log: () => {},
        getState: () => state,
        accounts: async () => [account],
        roleModels: async () => ({})
      }
      await startCoordinatorSession(ctx, { runId: job.value.id, cwd: '/repo', accountId: 'acc1', brief: 'PLAN IT', role: 'planner' })
      expect(spawned[0].bypassPermissions).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
