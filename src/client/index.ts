/**
 * @yeastcloud/dsh-anchor — Browser half.
 *
 * Registers one `settings.section` page (left nav entry + right panel) that
 * owns the host's `@yeastcloud/dsh-anchor` namespace. No floating overlay:
 * the shell's nav drives visibility, the panel is pure slot content.
 * All persistence rides `ctx.settingsScope` (host-backed when loopback).
 *
 * Page copy is registered as the `settings.anchor` locale namespace and handed
 * to the component as the slot's `t` seat, so both the nav entry and the page
 * follow the active DSH locale (zh/en) without a re-registration.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only slot + settings-scope augmentations.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the `ctx.locale` service, its typed namespace table, and the `t` seat.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ANCHOR_COPY, type AnchorCopyKey } from '../copy.ts'
import { NS, parseAnchorSettings } from '../types/anchor-settings.ts'
import { AnchorSettingsController } from './settings-controller.ts'
import { AnchorSettingsSection } from './AnchorSettingsSection.tsx'

/** Locale namespace owning this page's copy. */
export const LOCALE_NS = 'settings.anchor'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Settings-page copy of the anchor plugin. */
    'settings.anchor': AnchorCopyKey
  }
}

export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, ANCHOR_COPY), 'dsh-anchor: settings page copy')

  const scope = ctx.settingsScope.bind({
    namespace: NS,
    decode: parseAnchorSettings,
  })

  const controller = new AnchorSettingsController(scope, ctx.locale.bind(LOCALE_NS))
  ctx.effect(() => controller.attach(), 'dsh-anchor: settings scope adoption')

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
