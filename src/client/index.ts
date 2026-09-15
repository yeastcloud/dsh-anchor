/**
 * @yeastcloud/dsh-anchor — Browser half.
 *
 * Registers one `settings.section` page (left nav entry + right panel) that
 * owns the host's `@yeastcloud/dsh-anchor` namespace. No floating overlay:
 * the shell's nav drives visibility, the panel is pure slot content.
 * All persistence rides `ctx.settingsScope` (host-backed when loopback).
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only slot + settings-scope augmentations.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { NS, parseAnchorSettings } from '../types/anchor-settings.ts'
import { AnchorSettingsController } from './settings-controller.ts'
import { AnchorSettingsSection } from './AnchorSettingsSection.tsx'

export const inject = ['slots', 'connection', 'remote', 'settingsScope']

export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind({
    namespace: NS,
    decode: parseAnchorSettings,
  })

  const controller = new AnchorSettingsController(scope)
  ctx.effect(() => controller.attach(), 'dsh-anchor: settings scope adoption')

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'anchor',
        order: 25,
        label: '定锚',
        inject: () => ({ controller }),
      },
      AnchorSettingsSection,
    ),
  )

}
