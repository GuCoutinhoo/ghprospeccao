import { spawn } from 'node:child_process';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const isTsxLoaded = Boolean(
  process.env.TSX_LOADED === '1' ||
  process.execArgv.some((arg) => arg.includes('tsx')) ||
  process.env.npm_lifecycle_script?.includes('tsx')
);

if (!isTsxLoaded) {
  process.env.TSX_LOADED = '1';
  const child = spawn(process.execPath, ['--import', 'tsx', ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
  await new Promise(() => {});
}

const { default: app } = await import('./src/server/app');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  if (process.env.VERCEL) {
    return;
  }

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ProspectaPlaces Server] Rodando na porta ${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error('Falha ao iniciar o servidor:', err);
    process.exit(1);
  });
}

export { app };
export default app;
