export type ClosureIntent = 'CONFIRM_CLOSURE' | 'REJECT_CLOSURE' | 'NEUTRAL';

export class ClosureIntentDetector {
    private readonly explicitCommands = new Set([
        '/encerrar',
        'encerrar',
        'encerra',
        '/close',
        'close',
        '/finalizar',
        'finalizar',
        'finaliza',
        '/concluir',
        'concluir',
        'conclui',
        '/fechar',
        'fechar',
        'fecha',
        '/terminar',
        'terminar',
        'termina',
        '/fim',
        'fim',
        '/encerrar-sessao',
        'encerrar-sessao',
        'encerrar sessao',
        'encerra sessao',
        'encerrar a sessao',
        'encerra a sessao',
        'fechar sessao',
        'fecha sessao',
        'fechar a sessao',
        'fecha a sessao',
        'finalizar sessao',
        'finaliza sessao',
        'finalizar a sessao',
        'finaliza a sessao',
        'concluir sessao',
        'conclui sessao',
        'concluir a sessao',
        'conclui a sessao',
        'terminar sessao',
        'termina sessao',
        'terminar a sessao',
        'termina a sessao',
        'pode encerrar',
        'pode encerrar a sessao',
        'pode fechar',
        'pode fechar a sessao',
        'pode finalizar',
        'pode finalizar a sessao',
        'pode concluir',
        'pode concluir a sessao',
        'finalizar atendimento',
        'finaliza atendimento',
        'encerrar atendimento',
        'encerra atendimento',
        'fechar atendimento',
        'fecha atendimento',
    ]);

    private readonly closurePatterns = [
        /(?:pode|favor|por\s+favor|quero)?\s*(?:encerrar?|encerre|fechar?|feche|finalizar?|finalize|concluir?|conclui|terminar?|termine)\s+(?:a\s+|o\s+|da\s+|do\s+|de\s+)?(?:sessao|chamado|investigacao|caso|atendimento|ticket)/i,
        /^(?:sim\s+)?(?:pode|favor|por\s+favor|quero)?\s*(?:encerrar?|encerre|fechar?|feche|finalizar?|finalize|concluir?|terminar?)(?:\s*(?:por\s+favor|ai|agora))?$/i,
        /(?:problema|incidente|analise|caso)\s+(?:resolvid[oa]|finalizad[oa]|concluid[oa]|encerrad[oa])/i,
        /^(?:resolvid[oa]|finalizad[oa]|concluid[oa]|encerrad[oa])(?:,\s*pode\s+(?:fechar?|feche|encerrar?|encerre|finalizar?|finalize))?$/i,
        /(?:sessao|chamado|investigacao)\s+(?:concluid[oa]|encerrad[oa]|finalizad[oa])/i,
    ];

    private readonly affirmativeTokens = new Set([
        'sim',
        'yes',
        's',
        'ok',
        'pode ser',
        'isso mesmo',
        'com certeza',
        'fechado',
        'confirmo',
        'pode fechar',
        'pode encerrar',
        'pode finalizar',
        'pode concluir',
        'tudo certo',
        'concluido',
        'concluida',
        'finalizado',
        'finalizada',
        'encerrado',
        'encerrada',
        'resolvido',
        'resolvida',
        'pode gerar o resumo',
        'encerrar',
        'encerra',
        'fechar',
        'fecha',
        'finalizar',
        'finaliza',
        'concluir',
        'conclui',
        'terminar',
        'termina',
        'pode',
        'claro',
        'exato',
        'afirmativo',
        'sim pode fechar',
        'sim pode encerrar',
        'sim pode finalizar',
        'sim por favor',
        'sim obrigado',
        'sim valeu',
        'sim encerrar',
        'sim fechar',
        'sim finalizar',
        'sim concluir',
    ]);

    private readonly negativePatterns = [
        'nao',
        'no',
        'ainda nao',
        'espere',
        'espera',
        'nao encerre',
        'nao feche',
        'quero continuar',
        'continuar investigando',
        'continuar',
        'tenho outra duvida',
        'mais uma pergunta',
        'preciso analisar',
    ];

    private readonly acknowledgementTokens = new Set([
        'obrigado',
        'obrigada',
        'valeu',
        'show',
        'perfeito',
        'maravilha',
        'excelente',
        'otimo',
        'agradeco',
        'muito obrigado',
        'muito obrigada',
        'valeu demais',
        'valeu pela ajuda',
        'obrigado pela ajuda',
        'obrigada pela ajuda',
        'tks',
        'thanks',
        'thx',
        'thank you',
        'beleza',
        'blz',
        'valeu bot',
        'obrigado bot',
        'ok obrigado',
        'ok valeu',
    ]);

    detectIntent(message: string, isAwaitingConfirmation: boolean = false): ClosureIntent {
        if (!message || message.trim() === '') {
            return 'NEUTRAL';
        }

        const normalized = this.normalize(message);

        // 1. Checa negações explícitas de encerramento antes de qualquer padrão afirmativo
        for (const pattern of this.negativePatterns) {
            if (
                normalized === pattern ||
                normalized.startsWith(`${pattern} `) ||
                normalized.endsWith(` ${pattern}`) ||
                normalized.includes(` ${pattern} `)
            ) {
                return isAwaitingConfirmation ? 'REJECT_CLOSURE' : 'NEUTRAL';
            }
        }

        if (isAwaitingConfirmation) {
            // Se o usuário fez uma pergunta ou deu um novo comando longo de investigação
            if (normalized.includes('?') || normalized.startsWith('verifique') || normalized.startsWith('e como')) {
                return 'REJECT_CLOSURE';
            }

            // Checa afirmação direta quando aguardando
            if (
                this.affirmativeTokens.has(normalized) ||
                normalized === 'sim' ||
                normalized.startsWith('sim ') ||
                normalized.startsWith('s ')
            ) {
                return 'CONFIRM_CLOSURE';
            }
        }

        // 2. Verifica comandos explícitos exatos (ex: /encerrar, encerrar, finaliza a sessão)
        if (this.explicitCommands.has(normalized)) {
            return 'CONFIRM_CLOSURE';
        }

        // 3. Verifica padrões flexíveis de encerramento em qualquer contexto
        for (const pattern of this.closurePatterns) {
            if (pattern.test(normalized)) {
                return 'CONFIRM_CLOSURE';
            }
        }

        return 'NEUTRAL';
    }

    /**
     * Detecta se a mensagem é estritamente uma saudação/agradecimento de encerramento
     * (ex: "obrigado", "valeu", "show", "perfeito"), evitando a criação acidental
     * de novas sessões de investigação após o encerramento.
     */
    isAcknowledgement(message: string): boolean {
        if (!message || message.trim() === '') {
            return false;
        }
        const normalized = this.normalize(message);
        if (this.acknowledgementTokens.has(normalized)) {
            return true;
        }
        return /^(?:muito\s+)?(?:obrigad[oa]|valeu|agradeco|thanks|thank\s+you|tks|show|perfeito|excelente|maravilha|beleza|blz)(?:\s+(?:bot|amigo|demais|pela\s+ajuda))?$/i.test(normalized);
    }

    private normalize(text: string): string {
        return text
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[.,!?:;]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
}
