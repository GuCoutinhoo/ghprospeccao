import app from '../server';

export default function handler(req: any, res: any) {
  // Garante que o Express sempre receba a rota canônica correta mesmo após rewrites da Vercel
  const matched = req.headers['x-matched-path'] || req.headers['x-forwarded-uri'] || req.headers['x-original-uri'];
  if (matched && typeof matched === 'string' && matched.startsWith('/api')) {
    req.url = matched;
  } else if (typeof req.url === 'string' && !req.url.startsWith('/api')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }

  return app(req, res);
}
