import { clientBundle } from './build/tsdown.client.ts'

export default clientBundle('@yeastcloud/dsh-anchor', ['src/index.ts'], {
  lib: {
    external: ['@deepseek-ai/cordis'],
  },
})
