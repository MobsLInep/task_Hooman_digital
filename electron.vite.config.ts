import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const core = resolve(__dirname, 'src/core')
const migrationsDir = resolve(core, 'persistence/migrations')

function copyMigrations(): Plugin {
  return {
    name: 'task1:copy-migrations',
    generateBundle() {
      for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))) {
        this.emitFile({
          type: 'asset',
          fileName: `migrations/${file}`,
          source: readFileSync(resolve(migrationsDir, file), 'utf8')
        })
      }

      this.emitFile({
        type: 'asset',
        fileName: 'ollama-nodes.json',
        source: readFileSync(resolve(__dirname, 'resources/ollama-nodes.json'), 'utf8')
      })
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyMigrations()],
    resolve: {
      alias: { '@core': core }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),

          'workers/indexer': resolve(__dirname, 'src/workers/indexer.ts'),
          'workers/documentParser': resolve(__dirname, 'src/workers/documentParser.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@core': core,
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
