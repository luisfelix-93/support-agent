import crypto from 'crypto';
import type { ISessionRepository } from '../domain/ports/ISessionRepository.js';
import type { ChatProviderFactory } from '../infrastructure/chat/ChatProviderFactory.js';
import type { IChatRepository } from '../domain/ports/IChatRepository.js';
import { SessionSummary } from '../domain/workflows/SessionSummary.js';
import { Message } from '../domain/Message.js';
import {
    recordSessionClosureMetrics,
} from '../infrastructure/metrics/AgentMetrics.js';
import { logger } from '../config/logger.js';

const log = logger.child({ module: 'SessionTimeoutSweeper' });

export interface SweepResult {
    scanned: number;
    expired: number;
    warned: number;
    errors: number;
}

export class SessionTimeoutSweeper {
    constructor(
        private readonly sessionRepository: ISessionRepository,
        private readonly chatProviderFactory?: ChatProviderFactory,
        private readonly chatRepository?: IChatRepository
    ) {}

    async sweepExpiredSessions(referenceDate: Date = new Date(), limit: number = 50): Promise<SweepResult> {
        const result: SweepResult = {
            scanned: 0,
            expired: 0,
            warned: 0,
            errors: 0,
        };

        try {
            // Busca candidatas cuja última interação seja anterior ao timestamp atual
            const candidateSessions = await this.sessionRepository.findInactiveSessions(referenceDate, limit);
            result.scanned = candidateSessions.length;

            if (candidateSessions.length === 0) {
                return result;
            }

            const processedThreads = new Set<string>();

            for (const session of candidateSessions) {
                try {
                    const threadKey = `${session.workspaceId}:${session.threadId}`;
                    if (processedThreads.has(threadKey)) {
                        log.debug({ threadKey, sessionId: session.id }, 'Thread já processada neste sweep, ignorando duplicata.');
                        continue;
                    }

                    // 1. Encerramento automático por inatividade (30 minutos)
                    if (session.isExpired(referenceDate)) {
                        const summary = session.sessionSummary ?? SessionSummary.createFallback(session, 'timeout');

                        session.expireByTimeout(summary, referenceDate);
                        await this.sessionRepository.save(session);

                        recordSessionClosureMetrics(session, 'timeout');

                        result.expired++;
                        processedThreads.add(threadKey);
                        log.info(
                            { sessionId: session.id, threadId: session.threadId, workspaceId: session.workspaceId },
                            'Sessão de investigação encerrada por inatividade.'
                        );

                        // Notificação assíncrona para a thread no chat com o resumo executivo
                        await this.notifyThread(session, summary);
                        continue;
                    }

                    // 2. Aviso preventivo de inatividade (15 minutos)
                    if (session.isWarningNeeded(referenceDate)) {
                        session.proposeClosure();
                        session.recordWarning(referenceDate);
                        await this.sessionRepository.save(session);

                        result.warned++;
                        processedThreads.add(threadKey);
                        log.info(
                            { sessionId: session.id, threadId: session.threadId, workspaceId: session.workspaceId },
                            'Aviso de 15 minutos de inatividade enviado para a sessão.'
                        );

                        await this.notifyWarning(session);
                        continue;
                    }
                } catch (sessionError) {
                    result.errors++;
                    log.error({ err: sessionError, sessionId: session.id }, 'Falha ao processar sessão inativa.');
                }
            }
        } catch (error) {
            log.error({ err: error }, 'Erro ao executar varredura de sessões inativas.');
            result.errors++;
        }

        return result;
    }

    private compileFallbackSummary(session: any): SessionSummary {
        return SessionSummary.createFallback(session, 'timeout');
    }

    private async notifyThread(session: any, summary: SessionSummary): Promise<void> {
        const timeoutMessage = `⏱️ **Sessão de investigação encerrada automaticamente por inatividade.**\n\n${summary.toMarkdown()}`;

        // 1. Envio ao canal de chat via ChatProviderFactory
        if (this.chatProviderFactory) {
            try {
                const source = (session.metadata?.source as string) || (session.threadId?.startsWith('spaces/') ? 'google' : 'slack');
                const provider = await this.chatProviderFactory.getProvider(session.workspaceId, source);
                await provider.sendMessage(session.threadId, timeoutMessage);
            } catch (providerError) {
                log.warn({ err: providerError, sessionId: session.id }, 'Não foi possível enviar mensagem de encerramento ao chat provider.');
            }
        }

        // 2. Persistência do histórico de mensagens no ChatRepository
        if (this.chatRepository) {
            try {
                const context = await this.chatRepository.findById(session.threadId, session.workspaceId);
                if (context) {
                    context.addMessage(new Message(crypto.randomUUID(), 'assistant', timeoutMessage));
                    await this.chatRepository.save(context);
                }
            } catch (chatError) {
                log.warn({ err: chatError, sessionId: session.id }, 'Não foi possível persistir mensagem de encerramento no ChatRepository.');
            }
        }
    }

    private async notifyWarning(session: any): Promise<void> {
        const warningMessage =
            '⏱️ **Aviso de inatividade:** Não identifiquei novas mensagens nesta thread nos últimos 15 minutos. Posso encerrar esta sessão de investigação ou tem mais algum ponto que você queira analisar?\n\n' +
            '_Responda **"Sim"** para confirmar o encerramento e gerar o Resumo Executivo, ou envie sua mensagem caso deseje continuar a investigação._';

        // 1. Envio ao canal de chat via ChatProviderFactory
        if (this.chatProviderFactory) {
            try {
                const source = (session.metadata?.source as string) || (session.threadId?.startsWith('spaces/') ? 'google' : 'slack');
                const provider = await this.chatProviderFactory.getProvider(session.workspaceId, source);
                await provider.sendMessage(session.threadId, warningMessage);
            } catch (providerError) {
                log.warn({ err: providerError, sessionId: session.id }, 'Não foi possível enviar aviso de inatividade ao chat provider.');
            }
        }

        // 2. Persistência do histórico de mensagens no ChatRepository
        if (this.chatRepository) {
            try {
                const context = await this.chatRepository.findById(session.threadId, session.workspaceId);
                if (context) {
                    context.addMessage(new Message(crypto.randomUUID(), 'assistant', warningMessage));
                    await this.chatRepository.save(context);
                }
            } catch (chatError) {
                log.warn({ err: chatError, sessionId: session.id }, 'Não foi possível persistir aviso de inatividade no ChatRepository.');
            }
        }
    }
}
