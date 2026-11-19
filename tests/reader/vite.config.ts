import { defineConfig, mergeConfig } from 'vite'
import appConfig from '../../vite.config.ts'

// Exercise bundling of the reader and its worker without wiring a product page.
export default mergeConfig(appConfig, defineConfig({
  build: { assetsInlineLimit: 0, rolldownOptions: { input: ['index.html', 'tests/reader/index.html'] } },
}))
