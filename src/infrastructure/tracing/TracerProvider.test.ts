import { describe, it, expect, beforeAll } from 'vitest';
import { context, trace } from '@opentelemetry/api';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { withSpan, withContext, getTracer } from './TracerProvider.js';

describe('TracerProvider', () => {
    beforeAll(() => {
        const contextManager = new AsyncLocalStorageContextManager();
        contextManager.enable();
        context.setGlobalContextManager(contextManager);

        const provider = new BasicTracerProvider();
        trace.setGlobalTracerProvider(provider);
    });

    it('deve retornar o tracer instanciado', () => {
        const tracer = getTracer();
        expect(tracer).toBeDefined();
    });

    it('deve executar callback com withSpan com sucesso', async () => {
        const result = await withSpan('test.operation', async (span) => {
            expect(span).toBeDefined();
            return 42;
        });

        expect(result).toBe(42);
    });

    it('deve capturar erro e marcar status de erro no span', async () => {
        await expect(
            withSpan('test.failure', async () => {
                throw new Error('Falha simulada');
            })
        ).rejects.toThrow('Falha simulada');
    });

    it('deve executar withContext preservando o contexto fornecido', async () => {
        const tracer = getTracer();
        const rootSpan = tracer.startSpan('root-span');
        const customContext = trace.setSpan(context.active(), rootSpan);

        const res = await withContext(customContext, async () => {
            const activeSpan = trace.getSpan(context.active());
            expect(activeSpan).toBe(rootSpan);
            return 'context-ok';
        });

        expect(res).toBe('context-ok');
        rootSpan.end();
    });
});
