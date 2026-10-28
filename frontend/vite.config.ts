import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig, type Plugin } from 'vite'
import { compression } from 'vite-plugin-compression2'

/**
 * Preload the Latin Inter file, except on Apple platforms: there the font stack
 * resolves to the system font (SF Pro) and Inter is never downloaded at all.
 */
function preloadLatinFont(): Plugin {
  return {
    name: 'preload-latin-font',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const font = Object.keys(ctx.bundle ?? {}).find((file) => /inter-latin-wght-normal.*\.woff2$/.test(file))
        if (!font) return []
        return [
          {
            tag: 'script',
            injectTo: 'head',
            children:
              `if(!/Mac|iPhone|iPad|iPod/.test(navigator.platform||navigator.userAgent)){` +
              `var l=document.createElement('link');l.rel='preload';l.as='font';l.type='font/woff2';` +
              `l.crossOrigin='anonymous';l.href='/${font}';document.head.appendChild(l)}`,
          },
        ]
      },
    },
  }
}

/**
 * The page chunks are lazy, so without help the browser only discovers them (and
 * Recharts) after the entry script runs: one extra round trip before first paint.
 * This injects a tiny inline script that modulepreloads the current route's chunks
 * in parallel with the entry. Each route still loads only its own code.
 */
function preloadRouteChunks(): Plugin {
  return {
    name: 'preload-route-chunks',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const bundle = ctx.bundle ?? {}
        const chunks = Object.values(bundle).filter((c) => c.type === 'chunk')
        const entry = chunks.find((c) => c.isEntry)
        const staticGraph = (fileName: string, seen = new Set<string>()): Set<string> => {
          const chunk = bundle[fileName]
          if (!chunk || chunk.type !== 'chunk' || seen.has(fileName)) return seen
          seen.add(fileName)
          for (const dep of chunk.imports) staticGraph(dep, seen)
          return seen
        }
        const initial = entry ? staticGraph(entry.fileName) : new Set<string>()
        const routeFiles = (name: string) => {
          const page = chunks.find((c) => c.name === name)
          return page ? [...staticGraph(page.fileName)].filter((f) => !initial.has(f)).map((f) => `/${f}`) : []
        }
        const map = JSON.stringify({ accuracy: routeFiles('accuracy-view'), decision: routeFiles('decision-view') })
        return [
          {
            tag: 'script',
            injectTo: 'head-prepend',
            children:
              `(function(){var m=${map};var f=m[location.pathname.indexOf('/accuracy')===0?'accuracy':'decision'];` +
              `for(var i=0;i<f.length;i++){var l=document.createElement('link');l.rel='modulepreload';l.crossOrigin='';l.href=f[i];document.head.appendChild(l)}})()`,
          },
        ]
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    preloadLatinFont(),
    preloadRouteChunks(),
    // Brotli and gzip copies next to each asset; the API serves whichever the browser accepts.
    compression({ algorithms: ['brotliCompress', 'gzip'], threshold: 1024 }),
    visualizer({ filename: 'bundle-report.html', template: 'treemap', gzipSize: true, brotliSize: true }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // Vendor code in its own long-lived chunks, so an app change doesn't bust them.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
            {
              name: 'recharts',
              test: /node_modules[\\/](recharts|victory-vendor|d3-[^\\/]+|internmap|@reduxjs|redux|react-redux|reselect|immer|es-toolkit|decimal\.js-light|eventemitter3|tiny-invariant|use-sync-external-store)[\\/]/,
              priority: 20,
            },
            { name: 'dates', test: /node_modules[\\/](date-fns|@date-fns|react-day-picker)[\\/]/, priority: 20 },
          ],
        },
      },
    },
  },
  server: {
    // Forward API calls to the FastAPI dev server (see `make dev`).
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
