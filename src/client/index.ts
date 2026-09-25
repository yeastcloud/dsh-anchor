/**
 * @yeastcloud/dsh-anchor — Browser half.
 *
 * Registers one `settings.section` page (left nav entry + right panel) that
 * owns this plugin's settings document. No floating overlay: the shell's nav
 * drives visibility, the panel is pure slot content.
 *
 * Persistence rides `ctx.configForms` — the 0.1.7 settings provider, one shared
 * form per Host plugin ENTRY (the entry id, which this plugin keeps equal to its
 * namespace `NS`; see `cordis.patch.yml`).
 *
 * ★ The service is a REQUIRED inject, and the page mounts inside
 * `configForms.whileServed([NS], …)` — that is the shape the shipped page
 * packages use (see `dsh-client-ui-settings-web-search/lib/client.js`).
 * Registering at `apply` time and bailing out when the form is not ready yet
 * leaves the settings nav with NO anchor page at all (measured 2026-09-25).
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

export const inject = ['slots', 'locale', 'connection', 'remote', 'configForms']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, ANCHOR_COPY), 'dsh-anchor: settings page copy')

  // ★★ 页面必须挂在这里（官方页包同款）：`whileServed` 在该命名空间**被服务**时才跑回调，
  //    所以我们既不会早退掉注册（页面消失 ✗），也不会拿到一个还没就绪的表单。
  ctx.effect(
    () =>
      ctx.configForms.whileServed([NS], () => {
        const controller = new AnchorSettingsController(
          ctx.configForms.get<AnchorSettings>(NS),
          ctx.locale.bind(LOCALE_NS),
        )
        ctx.effect(() => controller.attach(), 'dsh-anchor: settings document adoption')
        return ctx.slots.inject('settings.section', () =>
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
      }),
    'dsh-anchor: settings section (mounted while the namespace is served)',
  )
}
