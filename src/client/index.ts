/**
 * @yeastcloud/dsh-anchor — Browser half.
 *
 * Registers one `settings.section` page (left nav entry + right panel) that
 * owns this plugin's settings document. No floating overlay: the shell's nav
 * drives visibility, the panel is pure slot content.
 *
 * Persistence rides `ctx.configForms` — the 0.1.7 settings provider, one shared
 * form per Host plugin ENTRY (the entry id, which this plugin keeps equal to its
 * namespace `NS`; see `cordis.patch.yml`). The service is optional: a shell that
 * does not compose it simply shows no page instead of failing to load this
 * bundle.
 *
 * Page copy is registered as the `settings.anchor` locale namespace and handed
 * to the component as the slot's `t` seat, so both the nav entry and the page
 * follow the active DSH locale (zh/en) without a re-registration.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only slot + settings augmentations.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the `ctx.locale` service, its typed namespace table, and the `t` seat.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ANCHOR_COPY, type AnchorCopyKey } from '../copy.ts'
import { NS, type AnchorSettings } from '../types/anchor-settings.ts'
import { AnchorSettingsController, type AnchorSettingsHost } from './settings-controller.ts'
import { AnchorSettingsSection } from './AnchorSettingsSection.tsx'

/** Locale namespace owning this page's copy. */
export const LOCALE_NS = 'settings.anchor'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Settings-page copy of the anchor plugin. */
    'settings.anchor': AnchorCopyKey
  }
}

export const inject = ['slots', 'locale', 'connection', 'remote']

/** The 0.1.7 settings provider: one shared form per Host plugin entry. */
interface ConfigFormsService {
  get<T>(entryId: string): AnchorSettingsHost<T>
}

/**
 * Resolve this instance's settings form.
 *
 * `ctx.get` is the documented read for a service that is NOT a declared
 * requirement: it answers undefined instead of failing, which is what lets a
 * shell without the settings provider keep this bundle loaded.
 *
 * The 0.1.7 namespace is the profile entry id, and this plugin's entry carries
 * the same id as its namespace (`NS`), so the document keeps the name it has
 * always had — and the Host's one-shot import of a retired `settings.yaml`
 * section lands on this very entry.
 *
 * @param ctx - browser context of this plugin instance.
 * @returns the form to page against, or undefined when no settings provider is composed.
 */
function resolveSettingsHost(ctx: ClientContext): AnchorSettingsHost<AnchorSettings> | undefined {
  const forms = ctx.get('configForms') as ConfigFormsService | undefined
  return forms?.get<AnchorSettings>(NS)
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, ANCHOR_COPY), 'dsh-anchor: settings page copy')

  const host = resolveSettingsHost(ctx)
  if (host === undefined) return

  const controller = new AnchorSettingsController(host, ctx.locale.bind(LOCALE_NS))
  ctx.effect(() => controller.attach(), 'dsh-anchor: settings document adoption')

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'anchor',
        order: 25,
        label: () => ctx.locale.bind(LOCALE_NS)('nav'),
        locale: LOCALE_NS,
        inject: () => ({ controller }),
      },
      AnchorSettingsSection,
    ),
  )
}
