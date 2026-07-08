import type { JwtPayload } from '../../usecases/LoginUserUseCase.js';

declare module 'express-serve-static-core' {
    interface Request {
        user?: JwtPayload;
    }
}
