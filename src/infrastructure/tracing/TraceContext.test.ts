import { describe, it, expect, beforeAll } from 'vitest';
import { trace, context } from '@opentelemetry/api';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { injectTraceContext, extractTraceContext } from './TraceContext.js';

describe('TraceContext', () => {
    beforeAll(() => {
        const contextManager = new AsyncLocalStorageContextManager();
        contextManager.enable();
        context.setGlobalContextManager(contextManager);

        const provider = new BasicTracerProvider();
        trace.setGlobalTracerProvider(provider);
    });

    it('deve injetar e extrair contexto W3C corretamente', async () => {
        const tracer = trace.getTracer('test-tracer');
        
        await tracer.startActiveSpan('test-span', async (span) => {
            const carrier: Record<string, string> = {};
            injectTraceContext(carrier);

            expect(carrier.traceparent).toBeDefined();
            expect(typeof carrier.traceparent).toBe('string');
            expect(carrier.traceparent).toContain(span.spanContext().traceId);

            const extractedContext = extractTraceContext(carrier);
            const extractedSpan = trace.getSpan(extractedContext);
            expect(extractedSpan?.spanContext().traceId).toBe(span.spanContext().traceId);

            span.end();
        });
    });

    it('deve retornar context.active() quando carrier for indefinido ou vazio', () => {
        const extracted = extractTraceContext(undefined);
        expect(extracted).toBeDefined();

        const emptyExtracted = extractTraceContext({});
        expect(emptyExtracted).toBeDefined();
    });
});
