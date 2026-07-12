/**
 * Vercel Serverless Function entry point.
 *
 * Exporta o Express app como catch-all handler.
 * Todas as requisições são roteadas para cá via vercel.json rewrites.
 *
 * Em produção (Vercel), as variáveis de ambiente são injetadas
 * automaticamente pela plataforma — não é necessário dotenv.
 *
 * IMPORTANTE: `bodyParser: false` desabilita o body parser automático da Vercel.
 * Sem isso, a Vercel consome o stream do body antes do Express, fazendo com
 * que req.body fique {} e o url_verification do Slack falhe com challenge_failed.
 */
import app from '../src/app.js';

// Desabilita o body parser automático da Vercel para que o express.json()
// (com o verify callback que captura req.rawBody) funcione corretamente.
export const config = {
    api: {
        bodyParser: false,
    },
};

export default app;
