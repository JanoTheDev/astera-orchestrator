import os from 'node:os'
import type { MachineSpecs } from '../types'
import { recommendedWorkerCap } from './machineCap'

/** This machine's memory and CPUs and the worker cap they support. Node side only. */
export function machineSpecs(): MachineSpecs {
  const totalMemBytes = os.totalmem()
  const logicalCpus = os.availableParallelism?.() ?? os.cpus().length
  return { totalMemBytes, freeMemBytes: os.freemem(), logicalCpus, recommended: recommendedWorkerCap({ totalMemBytes, logicalCpus }) }
}
