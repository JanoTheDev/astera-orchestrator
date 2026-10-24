import type { ModelDescriptor, ModelListResult } from './types'

/**
 * The effort levels `model` accepts, out of an account's model list: `undefined` when the list cannot
 * tell (no such model), `[]` when the model takes no effort.
 *
 * Matched as effortChoicesOf (cliModels.ts) matches, by id or name, plus the full name an alias
 * resolves to (claude's `resolvedModel`) and an alias of a fuller id (`gpt-5.6` for `gpt-5.6-sol`).
 * No model is the CLI default, the `isDefault` entry. Unlike effortChoicesOf, an unknown model does
 * not fall back to the default: a start would then clamp to levels of a model it is not running.
 */
export function effortLevelsOf(models: readonly ModelDescriptor[], model: string | undefined): string[] | undefined {
  const wanted = model?.trim().toLowerCase() ?? ''
  const match =
    wanted === ''
      ? models.find((m) => m.isDefault === true)
      : (models.find((m) => [m.id, m.name, m.resolvedModel].some((v) => v?.toLowerCase() === wanted)) ??
        models.find((m) => m.id.toLowerCase().startsWith(`${wanted}-`)))
  return match ? (match.effortLevels ?? []) : undefined
}

/**
 * `effortLevelsFor(accountId, model)` over `list`, which asks one account's CLI for its models. Asked
 * once per account for the life of the lookup, lazily, and calls that arrive together share the one
 * round trip. A failed list is not kept, so the next start asks again (logged in since, say).
 */
export function createEffortLevelsLookup(
  list: (accountId: string) => Promise<ModelListResult>
): (accountId: string, model: string | undefined) => Promise<string[] | undefined> {
  const lists = new Map<string, Promise<ModelDescriptor[] | null>>()
  return async (accountId, model) => {
    let models = lists.get(accountId)
    if (!models) {
      models = list(accountId).then(
        (r) => (r.error ? null : r.models),
        () => null
      )
      lists.set(accountId, models)
      void models.then((m) => {
        if (m === null) lists.delete(accountId)
      })
    }
    const got = await models
    return got === null ? undefined : effortLevelsOf(got, model)
  }
}
