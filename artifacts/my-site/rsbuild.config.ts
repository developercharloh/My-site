import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginSass } from '@rsbuild/plugin-sass';

const path = require('path');

export default defineConfig({
    plugins: [
        pluginSass({
            sassLoaderOptions: {
                sourceMap: true,
                sassOptions: {},
            },
            exclude: /node_modules/,
        }),
        pluginReact(),
    ],
    source: {
        entry: {
            index: './src/main.tsx',
        },
        define: {
            'process.env': {
                TRANSLATIONS_CDN_URL: JSON.stringify(process.env.TRANSLATIONS_CDN_URL),
                R2_PROJECT_NAME: JSON.stringify(process.env.R2_PROJECT_NAME),
                CROWDIN_BRANCH_NAME: JSON.stringify(process.env.CROWDIN_BRANCH_NAME),
                TRACKJS_TOKEN: JSON.stringify(process.env.TRACKJS_TOKEN),
                APP_ENV: JSON.stringify(process.env.APP_ENV),
                REF_NAME: JSON.stringify(process.env.REF_NAME),
                REMOTE_CONFIG_URL: JSON.stringify(process.env.REMOTE_CONFIG_URL),
                GD_CLIENT_ID: JSON.stringify(process.env.GD_CLIENT_ID),
                GD_APP_ID: JSON.stringify(process.env.GD_APP_ID),
                GD_API_KEY: JSON.stringify(process.env.GD_API_KEY),
                DATADOG_SESSION_REPLAY_SAMPLE_RATE: JSON.stringify(process.env.DATADOG_SESSION_REPLAY_SAMPLE_RATE),
                DATADOG_SESSION_SAMPLE_RATE: JSON.stringify(process.env.DATADOG_SESSION_SAMPLE_RATE),
                DATADOG_APPLICATION_ID: JSON.stringify(process.env.DATADOG_APPLICATION_ID),
                DATADOG_CLIENT_TOKEN: JSON.stringify(process.env.DATADOG_CLIENT_TOKEN),
                RUDDERSTACK_KEY: JSON.stringify(process.env.RUDDERSTACK_KEY),
                GROWTHBOOK_CLIENT_KEY: JSON.stringify(process.env.GROWTHBOOK_CLIENT_KEY),
                GROWTHBOOK_DECRYPTION_KEY: JSON.stringify(process.env.GROWTHBOOK_DECRYPTION_KEY),
            },
        },
    },
    resolve: {
        alias: {
            react: path.resolve('./node_modules/react'),
            'react-dom': path.resolve('./node_modules/react-dom'),
            '@deriv/quill-icons/Illustration': path.resolve(__dirname, './src/mocks/quill-icons-illustration.tsx'),
            '@/external': path.resolve(__dirname, './src/external'),
            '@/components': path.resolve(__dirname, './src/components'),
            '@/hooks': path.resolve(__dirname, './src/hooks'),
            '@/utils': path.resolve(__dirname, './src/utils'),
            '@/constants': path.resolve(__dirname, './src/constants'),
            '@/stores': path.resolve(__dirname, './src/stores'),
            '@/mocks': path.resolve(__dirname, './src/mocks'),
        },
    },
    output: {
        copy: [
            {
                from: 'node_modules/@deriv/deriv-charts/dist/*',
                to: 'js/smartcharts/[name][ext]',
                globOptions: {
                    ignore: ['**/*.LICENSE.txt'],
                },
            },
            { from: 'node_modules/@deriv/deriv-charts/dist/chart/assets/*', to: 'assets/[name][ext]' },
            { from: 'node_modules/@deriv/deriv-charts/dist/chart/assets/fonts/*', to: 'assets/fonts/[name][ext]' },
            { from: 'node_modules/@deriv/deriv-charts/dist/chart/assets/shaders/*', to: 'assets/shaders/[name][ext]' },
            { from: path.join(__dirname, 'public') },
        ],
        // Ensure service worker is not cached by the browser
        filename: {
            js: ({ chunk }) => {
                // Don't add hash to service worker
                if (chunk?.name === 'sw') {
                    return '[name].js';
                }
                return '[name].[contenthash:8].js';
            },
        },
    },
    performance: {
        chunkSplit: {
            strategy: 'split-by-experience',
            override: {
                cacheGroups: {
                    blockly: {
                        test: /[\\/]node_modules[\\/]blockly[\\/]/,
                        name: 'lib-blockly',
                        priority: 30,
                        chunks: 'all',
                        reuseExistingChunk: true,
                    },
                    derivCharts: {
                        test: /[\\/]node_modules[\\/]@deriv[\\/]deriv-charts[\\/]/,
                        name: 'lib-deriv-charts',
                        priority: 28,
                        chunks: 'all',
                        reuseExistingChunk: true,
                    },
                    derivApi: {
                        test: /[\\/]node_modules[\\/]@deriv[\\/](deriv-api|js-interpreter)[\\/]/,
                        name: 'lib-deriv-api',
                        priority: 26,
                        chunks: 'all',
                        reuseExistingChunk: true,
                    },
                    derivCom: {
                        test: /[\\/]node_modules[\\/]@deriv-com[\\/]/,
                        name: 'lib-deriv-com',
                        priority: 24,
                        chunks: 'all',
                        reuseExistingChunk: true,
                    },
                    quill: {
                        test: /[\\/]node_modules[\\/]@deriv[\\/]quill-icons[\\/]/,
                        name: 'lib-quill-icons',
                        priority: 22,
                        chunks: 'all',
                        reuseExistingChunk: true,
                    },
                    mobx: {
                        test: /[\\/]node_modules[\\/](mobx|mobx-react-lite|mobx-utils|mobx-persist-store)[\\/]/,
                        name: 'lib-mobx',
                        priority: 20,
                        chunks: 'all',
                        reuseExistingChunk: true,
                    },
                    monitoring: {
                        test: /[\\/]node_modules[\\/](@datadog|trackjs)[\\/]/,
                        name: 'lib-monitoring',
                        priority: 18,
                        chunks: 'all',
                        reuseExistingChunk: true,
                    },
                    framerMotion: {
                        test: /[\\/]node_modules[\\/]framer-motion[\\/]/,
                        name: 'lib-framer-motion',
                        priority: 16,
                        chunks: 'all',
                        reuseExistingChunk: true,
                    },
                },
            },
        },
        removeConsole: ['log'],
    },
    html: {
        template: './index.html',
    },
    server: {
        port: Number(process.env.PORT) || 5000,
        host: '0.0.0.0',
        compress: true,
        headers: {
            'Cross-Origin-Opener-Policy': 'unsafe-none',
            'Cross-Origin-Embedder-Policy': 'unsafe-none',
            'Cache-Control': 'no-cache',
        },
    },
    dev: {
        hmr: true,
        setupMiddlewares: [
            middlewares => {
                const fs = require('fs');
                const pathMod = require('path');
                const PUBLIC_DIR = pathMod.join(__dirname, 'public');
                const DTRADER_PUBLIC_DIR = pathMod.join(PUBLIC_DIR, 'dtrader');
                const MIME: Record<string, string> = {
                    '.js': 'application/javascript; charset=utf-8',
                    '.mjs': 'application/javascript; charset=utf-8',
                    '.css': 'text/css; charset=utf-8',
                    '.json': 'application/json; charset=utf-8',
                    '.svg': 'image/svg+xml',
                    '.png': 'image/png',
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.gif': 'image/gif',
                    '.webp': 'image/webp',
                    '.ico': 'image/x-icon',
                    '.woff': 'font/woff',
                    '.woff2': 'font/woff2',
                    '.ttf': 'font/ttf',
                    '.eot': 'application/vnd.ms-fontobject',
                    '.map': 'application/json; charset=utf-8',
                    '.wasm': 'application/wasm',
                };
                const safeResolve = (root: string, urlPath: string): string | null => {
                    let decoded: string;
                    try {
                        decoded = decodeURIComponent(urlPath);
                    } catch {
                        return null;
                    }
                    if (decoded.indexOf('\0') !== -1) return null;
                    const normalised = pathMod.posix.normalize(decoded.replace(/\\/g, '/'));
                    if (normalised.startsWith('..') || normalised.includes('/../')) return null;
                    const stripped = normalised.replace(/^\/+/, '');
                    const resolved = pathMod.resolve(root, stripped);
                    const rootWithSep = root.endsWith(pathMod.sep) ? root : root + pathMod.sep;
                    if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;
                    return resolved;
                };
                middlewares.unshift((req: any, res: any, next: any) => {
                    const rawUrl = (req.url || '').split('?')[0];
                    if (!/^\/(js|css|media|fonts|assets)\//.test(rawUrl)) return next();
                    const apolloPath = safeResolve(PUBLIC_DIR, rawUrl);
                    if (!apolloPath) return next();
                    fs.access(apolloPath, fs.constants.F_OK, (apolloErr: any) => {
                        if (!apolloErr) return next();
                        const dtraderPath = safeResolve(DTRADER_PUBLIC_DIR, rawUrl);
                        if (!dtraderPath) return next();
                        fs.access(dtraderPath, fs.constants.F_OK, (dtraderErr: any) => {
                            if (dtraderErr) return next();
                            const ext = pathMod.extname(dtraderPath).toLowerCase();
                            const ct = MIME[ext] || 'application/octet-stream';
                            res.setHeader('Content-Type', ct);
                            res.setHeader('Cache-Control', 'no-cache');
                            const stream = fs.createReadStream(dtraderPath);
                            stream.on('error', (streamErr: any) => next(streamErr));
                            stream.pipe(res);
                        });
                    });
                });
            },
        ],
    },
    tools: {
        rspack: {
            plugins: [],
            resolve: {},
            module: {
                rules: [
                    {
                        test: /\.xml$/,
                        exclude: /node_modules/,
                        type: 'asset/source',
                    },
                    {
                        test: /node_modules[\\/]@deriv-com[\\/]translations[\\/]dist[\\/].+\.js$/,
                        enforce: 'pre',
                        loader: path.resolve(__dirname, './scripts/translations-patcher-loader.cjs'),
                    },
                ],
            },
        },
    },
});
