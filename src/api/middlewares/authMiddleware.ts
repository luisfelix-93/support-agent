import { Request, Response, NextFunction } from 'express';
import { LoginUserUseCase } from '../../usecases/LoginUserUseCase.js';

export async function authMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized: missing or invalid Authorization header.' });
        return;
    }

    const token = authHeader.slice(7);

    try {
        const payload = await LoginUserUseCase.verify(token);
        req.user = payload;
        next();
    } catch {
        res.status(401).json({ error: 'Unauthorized: invalid or expired token.' });
    }
}
