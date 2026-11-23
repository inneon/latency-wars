import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../../node_modules/.vite/libs/playtest/adapters/briefing',
  plugins: [tsconfigPaths({ root: '../../../..' })],
  test: {
    name: 'playtest-briefing',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../../coverage/libs/playtest/adapters/briefing',
      provider: 'v8' as const,
    }
  },
}));
