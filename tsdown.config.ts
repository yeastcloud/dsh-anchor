import { clientBundle } from './build/tsdown.client.ts'

export default clientBundle('@yisiyun/dsh-anchor', ['src/index.ts'], {
  lib: {
    external: ['@deepseek-ai/cordis'],
  },
})
