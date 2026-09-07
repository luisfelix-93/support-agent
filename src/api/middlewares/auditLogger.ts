import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../config/logger.js';

const auditLog = logger.child({ module: 'audit' });

export function auditLogger(action: string) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const startTime = Date.now();

        res.on('finish', () => {
            auditLog.info({
                action,
                userId: req.user?.sub ?? 'anonymous',
                email: req.user?.email,
                role: req.user?.role,
                method: req.method,
                path: req.originalUrl,
                statusCode: res.statusCode,
                ip: req.ip,
                durationMs: Date.now() - startTime,
            });
        });

        next();
    };
}
