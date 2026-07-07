import 'dotenv/config';
import app from './app.js';

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
    console.log(`[Support Agent] 🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`[Support Agent] Health check: http://localhost:${PORT}/api/health`);
});
