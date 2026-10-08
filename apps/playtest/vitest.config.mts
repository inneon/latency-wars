import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/playtest',
  plugins: [tsconfigPaths({ root: '../..' })],
  test: {
    name: 'playtest',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    reporters: ['default'],
    coverage: { reportsDirectory: '../../coverage/apps/playtest', provider: 'v8' as const },
  },
}));
