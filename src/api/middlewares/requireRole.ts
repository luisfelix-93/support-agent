import type { Request, Response, NextFunction } from 'express';
import { Role } from '../../domain/Role.js';

export function requireRole(...allowedRoles: Role[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const userRole = req.user?.role;

        if (!userRole || !allowedRoles.includes(userRole)) {
            res.status(403).json({ error: 'Forbidden: insufficient permissions.' });
            return;
        }

        next();
    };
}
