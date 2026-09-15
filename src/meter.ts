/**
 * Context-token pressure for @yeastcloud/dsh-anchor, read from the official
 * token meter.
 *
 * The number is `contextPressure`, the session projection `dsh-token-meter`
 * registers in `ctx.sessionProjections`: the provider-reported prompt size of
 * the latest request plus the priced movement of everything the session surface
 * gained or lost since that report, so it answers for the NEXT request instead
 * of the last one. It is the same figure the Web GUI renders beside the send
 * button, which is why the trigger's threshold is an absolute token count.
 *
 * Reading it is replay-safe rather than a live counter: the projection unit is a
 * pure fold the registry drives over the session's own committed events, and a
 * fresh process, a resumed session, or a replayed log therefore produce the
 * same value for the same log. The reading carries no state of its own — the
 * one piece of process-local state this plugin keeps is the trigger's armed
 * flag (`pressureStep` in `./trigger.ts`).
 *
 * Both imports below are type-only: the meter and the projection registry are
 * peer capabilities of the profile, so a profile without the token meter loads
 * this plugin unchanged and reads no pressure at all.
 *
 * @module @yeastcloud/dsh-anchor/meter
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
// Type-only: the `ctx.sessionProjections` registry, and the `contextPressure`
// entry dsh-token-meter merges into the projection map.
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-token-meter'

/**
 * Context pressure of one session in tokens, or undefined when nothing measured
 * it (no token meter mounted, no provider usage reported yet).
 */
export type PressureReader = (session: Session) => number | undefined

/**
 * Read one session's current context pressure through the official token meter.
 *
 * The registry is read with `ctx.get`, not through `inject`: the meter is an
 * optional capability, and a missing registry or a missing `contextPressure`
 * key both answer undefined — capability absence, never a failure of the step
 * that asked. `projectedTokens` wins over `pressureTokens` because that is the
 * precedence the GUI's own context meter renders.
 * @param ctx - host context, read for the session-projection registry.
 * @param session - session whose pressure is read.
 * @returns the context figure in tokens, or undefined when unmeasured.
 */
export function meterPressure(ctx: Context, session: Session): number | undefined {
  const projections = ctx.get('sessionProjections')
  if (projections === undefined) return undefined
  const pressure = projections.snapshot(session, ['contextPressure']).values.contextPressure
  return pressure?.projectedTokens ?? pressure?.pressureTokens
}
