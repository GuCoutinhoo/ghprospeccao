import app from '../src/server/app';
import { db } from '../src/lib/store/db';

export default async function handler(req: any, res: any) {
  const matched = req.headers['x-matched-path'] || req.headers['x-forwarded-uri'] || req.headers['x-original-uri'];
  if (matched && typeof matched === 'string' && matched.startsWith('/api')) {
    req.url = matched;
  } else if (typeof req.url === 'string' && !req.url.startsWith('/api')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }

  try {
    await db.ensureInitialized();
  } catch (err) {
    console.warn('[Vercel Serverless] Erro na inicialização do Firestore:', err);
  }

  return app(req, res);
}
