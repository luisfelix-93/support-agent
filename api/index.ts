/**
 * Vercel Serverless Function entry point.
 *
 * Exporta o Express app como catch-all handler.
 * Todas as requisições são roteadas para cá via vercel.json rewrites.
 *
 * Em produção (Vercel), as variáveis de ambiente são injetadas
 * automaticamente pela plataforma — não é necessário dotenv.
 */
import app from '../src/app.js';

export default app;
