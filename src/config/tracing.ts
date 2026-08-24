import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

/**
 * Parsing de headers OTLP no formato "key=val,key2=val2" ou JSON
 */
function parseOtlpHeaders(headerStr?: string): Record<string, string> | undefined {
    if (!headerStr) return undefined;
    try {
        if (headerStr.startsWith('{')) {
            return JSON.parse(headerStr);
        }
        const headers: Record<string, string> = {};
        for (const pair of headerStr.split(',')) {
            const [k, ...v] = pair.split('=');
            if (k && v.length > 0) {
                headers[k.trim()] = v.join('=').trim();
            }
        }
        return headers;
    } catch {
        return undefined;
    }
}

const serviceName = process.env.OTEL_SERVICE_NAME || 'support-agent';
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const otlpHeaders = parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);

if (process.env.OTEL_LOG_LEVEL === 'debug') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

let sdk: NodeSDK | null = null;
let isStarted = false;

// Inicializa o tracing apenas se configurado ou se habilitado explicitamente
const isTracingEnabled = Boolean(otlpEndpoint || process.env.OTEL_ENABLED === 'true');

if (isTracingEnabled) {
    const traceExporter = new OTLPTraceExporter({
        url: otlpEndpoint || 'http://localhost:4318/v1/traces',
        headers: otlpHeaders,
    });

    sdk = new NodeSDK({
        serviceName,
        traceExporter,
        instrumentations: [
            getNodeAutoInstrumentations({
                // Desativa ruído de I/O em disco para manter os traces limpos e focados
                '@opentelemetry/instrumentation-fs': {
                    enabled: false,
                },
            }),
        ],
    });

    try {
        sdk.start();
        isStarted = true;
    } catch (error) {
        console.error('Falha ao iniciar OpenTelemetry SDK:', error);
    }
}

/**
 * Encerra o OpenTelemetry SDK de forma limpa (flush de spans pendentes).
 */
export async function shutdownTracing(): Promise<void> {
    if (sdk && isStarted) {
        try {
            await sdk.shutdown();
        } catch (error) {
            console.error('Erro ao finalizar OpenTelemetry SDK:', error);
        } finally {
            isStarted = false;
        }
    }
}
