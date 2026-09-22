export type ClosureIntent = 'CONFIRM_CLOSURE' | 'REJECT_CLOSURE' | 'NEUTRAL';

export class ClosureIntentDetector {
    private readonly explicitCommands = new Set([
        '/encerrar',
        'encerrar',
        '/close',
        'close',
        '/finalizar',
        'finalizar',
        '/concluir',
        'concluir',
        '/fechar',
        'fechar',
        '/terminar',
        'terminar',
        '/fim',
        'fim',
        '/encerrar-sessao',
        'encerrar-sessao',
        'encerrar sessao',
        'fechar sessao',
        'finalizar sessao',
        'concluir sessao',
    ]);

    private readonly closurePatterns = [
        /(?:pode|favor|por\s+favor|quero)?\s*(?:encerrar|fechar|finalizar|concluir|terminar)\s*(?:a\s+|o\s+|da\s+|do\s+|de\s+)?(?:sessao|chamado|investigacao|analise|caso|atendimento|ticket)?/i,
        /pode\s+(?:encerrar|fechar|finalizar|concluir|terminar)/i,
        /(?:problema|incidente|analise|caso)\s+(?:resolvido|finalizado|concluido|encerrado)/i,
        /^(?:resolvido|finalizado|concluido|encerrado)(?:,\s*pode\s+(?:fechar|encerrar))?$/i,
        /(?:sessao|chamado|investigacao|analise)\s+(?:concluida|encerrada|finalizada)/i,
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
        'fechar',
        'finalizar',
        'concluir',
        'pode',
        'claro',
        'exato',
        'afirmativo',
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

    detectIntent(message: string, isAwaitingConfirmation: boolean = false): ClosureIntent {
        if (!message || message.trim() === '') {
            return 'NEUTRAL';
        }

        const normalized = this.normalize(message);

        // 1. Verifica comandos explícitos exatos (ex: /encerrar, encerrar)
        if (this.explicitCommands.has(normalized)) {
            return 'CONFIRM_CLOSURE';
        }

        // 2. Verifica padrões flexíveis de encerramento em qualquer contexto
        for (const pattern of this.closurePatterns) {
            if (pattern.test(normalized)) {
                return 'CONFIRM_CLOSURE';
            }
        }

        // 3. Se a sessão estiver aguardando confirmação do operador
        if (isAwaitingConfirmation) {
            // Checa afirmação direta
            if (this.affirmativeTokens.has(normalized)) {
                return 'CONFIRM_CLOSURE';
            }

            // Checa negação ou intenção explícita de continuação
            for (const pattern of this.negativePatterns) {
                if (normalized.includes(pattern)) {
                    return 'REJECT_CLOSURE';
                }
            }

            // Se o usuário fez uma pergunta ou deu um novo comando longo de investigação
            if (normalized.includes('?') || normalized.startsWith('verifique') || normalized.startsWith('e como')) {
                return 'REJECT_CLOSURE';
            }
        }

        return 'NEUTRAL';
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
