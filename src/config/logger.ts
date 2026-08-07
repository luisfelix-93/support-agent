import pino from 'pino';

/**
 * Logger central da aplicação (pino).
 *
 * Destinos:
 *  - stdout: sempre ativo. Em produção escreve JSON estruturado (coletável por
 *    qualquer agente do cluster); em desenvolvimento usa pino-pretty.
 *  - Loki: ativo apenas quando LOKI_HOST está definido. O envio é feito em uma
 *    worker thread separada (pino.transport) com batching e `silenceErrors`,
 *    garantindo que a aplicação continue funcionando normalmente mesmo se o
 *    servidor Loki estiver inacessível. Nesse cenário os logs permanecem
 *    disponíveis no stdout (ex.: `kubectl logs`).
 *
 * Configuração via variáveis de ambiente:
 *  - LOG_LEVEL      (padrão: 'info' em produção, 'debug' em dev)
 *  - LOKI_HOST      (ex.: https://loki.exemplo.com)
 *  - LOKI_USER      (usuário para autenticação básica — opcional)
 *  - LOKI_PASSWORD  (senha para autenticação básica — opcional)
 */

const isProduction = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug');

const targets: pino.TransportTargetOptions[] = [
    isProduction
        // JSON puro no stdout (fd 1) — legível pelo container runtime / k3s
        ? { target: 'pino/file', options: { destination: 1 }, level }
        : {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
                ignore: 'pid,hostname',
            },
            level,
        },
];

if (process.env.LOKI_HOST) {
    targets.push({
        target: 'pino-loki',
        options: {
            host: process.env.LOKI_HOST,
            basicAuth:
                process.env.LOKI_USER && process.env.LOKI_PASSWORD
                    ? `${process.env.LOKI_USER}:${process.env.LOKI_PASSWORD}`
                    : undefined,
            // Envia em lotes a cada 5s — reduz requisições e isola falhas
            batching: true,
            interval: 5,
            // Loki exige timestamp em nanossegundos; o transport converte
            replaceTimestamp: true,
            // Falhas de envio ao Loki não devem poluir o stderr nem afetar a app
            silenceErrors: true,
            labels: {
                app: 'support-agent',
                environment: process.env.NODE_ENV ?? 'development',
            },
        },
        level,
    });
}

export const logger = pino({
    level,
    transport: { targets },
});
