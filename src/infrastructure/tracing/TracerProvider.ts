import {
    context,
    trace,
    SpanKind,
    SpanStatusCode,
    type Attributes,
    type Context,
    type Span,
    type SpanOptions,
    type Tracer,
} from '@opentelemetry/api';

const TRACER_NAME = 'support-agent';
const tracer: Tracer = trace.getTracer(TRACER_NAME);

export function getTracer(): Tracer {
    return tracer;
}

export interface WithSpanOptions extends SpanOptions {
    attributes?: Attributes;
    kind?: SpanKind;
}

/**
 * Executa uma função assíncrona dentro de um span filho ativo do OpenTelemetry.
 * Trata automaticamente sucesso (OK), registro de exceções e fechamento do span.
 */
export async function withSpan<T>(
    name: string,
    optionsOrFn: WithSpanOptions | ((span: Span) => Promise<T>),
    fn?: (span: Span) => Promise<T>
): Promise<T> {
    const options: WithSpanOptions = typeof optionsOrFn === 'function' ? {} : optionsOrFn;
    const callback = typeof optionsOrFn === 'function' ? optionsOrFn : fn!;

    return tracer.startActiveSpan(name, options, async (span: Span) => {
        try {
            const result = await callback(span);
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
        } catch (error) {
            span.recordException(error as Error);
            span.setStatus({
                code: SpanStatusCode.ERROR,
                message: error instanceof Error ? error.message : String(error),
            });
            throw error;
        } finally {
            span.end();
        }
    });
}

/**
 * Executa uma função assíncrona dentro de um contexto OpenTelemetry específico (ex: contexto extraído de um job de fila).
 */
export async function withContext<T>(
    extractedContext: Context,
    fn: () => Promise<T>
): Promise<T> {
    return context.with(extractedContext, fn);
}
