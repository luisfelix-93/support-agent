import { Request, Response } from 'express';
import { LoginUserUseCase } from '../usecases/LoginUserUseCase.js';

export class AuthController {
    constructor(private readonly loginUseCase: LoginUserUseCase) {}

    async login(req: Request, res: Response): Promise<void> {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                res.status(400).json({ error: 'Fields "email" and "password" are required.' });
                return;
            }

            const result = await this.loginUseCase.execute({ email, password });
            res.status(200).json(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Authentication failed.';
            res.status(401).json({ error: message });
        }
    }
}
