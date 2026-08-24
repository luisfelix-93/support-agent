import { context, type Context } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

/**
 * Utilitários para injeção e extração de contexto W3C (traceparent/tracestate)
 * para propagação distribuída em filas assíncronas (BullMQ) e chamadas remotas.
 */

const w3cPropagator = new W3CTraceContextPropagator();

/**
 * Injeta o contexto de trace ativo no carrier (objeto de chave/valor).
 */
export function injectTraceContext(carrier: Record<string, string> = {}): Record<string, string> {
    const activeContext = context.active();
    w3cPropagator.inject(activeContext, carrier, {
        set(holder: Record<string, string>, key: string, value: string) {
            holder[key] = value;
        },
    });
    return carrier;
}

/**
 * Extrai um Context do OpenTelemetry a partir do carrier recebido.
 */
export function extractTraceContext(carrier?: Record<string, unknown>): Context {
    if (!carrier) {
        return context.active();
    }
    const stringCarrier: Record<string, string> = {};
    for (const [key, value] of Object.entries(carrier)) {
        if (typeof value === 'string') {
            stringCarrier[key.toLowerCase()] = value;
        }
    }
    return w3cPropagator.extract(context.active(), stringCarrier, {
        get(holder: Record<string, string>, key: string) {
            return holder[key];
        },
        keys(holder: Record<string, string>) {
            return Object.keys(holder);
        },
    });
}

