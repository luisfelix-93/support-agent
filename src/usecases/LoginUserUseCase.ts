import { SignJWT, jwtVerify } from 'jose';
import { IUserRepository } from '../domain/ports/IUserRepository.js';

interface LoginInput {
    email: string;
    password: string;
}

export interface JwtPayload {
    sub: string;
    email: string;
    workspaceIds: string[];
}

export class LoginUserUseCase {
    private readonly secret: Uint8Array;
    private readonly expiresIn: string;

    constructor(private readonly userRepository: IUserRepository) {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            throw new Error('JWT_SECRET environment variable is not defined.');
        }
        this.secret = new TextEncoder().encode(secret);
        this.expiresIn = process.env.JWT_EXPIRES_IN ?? '8h';
    }

    async execute(input: LoginInput): Promise<{ token: string }> {
        const user = await this.userRepository.findByEmail(input.email);
        if (!user) {
            throw new Error('Invalid credentials.');
        }

        const isValid = user.password.compare(input.password);
        if (!isValid) {
            throw new Error('Invalid credentials.');
        }

        const token = await new SignJWT({
            email: user.email,
            workspaceIds: user.workspaceId,
        })
            .setProtectedHeader({ alg: 'HS256' })
            .setSubject(user.id)
            .setIssuedAt()
            .setExpirationTime(this.expiresIn)
            .sign(this.secret);

        return { token };
    }

    static async verify(token: string): Promise<JwtPayload> {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            throw new Error('JWT_SECRET environment variable is not defined.');
        }
        const key = new TextEncoder().encode(secret);
        const { payload } = await jwtVerify(token, key);
        return {
            sub: payload.sub as string,
            email: payload['email'] as string,
            workspaceIds: (payload['workspaceIds'] as string[]) ?? [],
        };
    }
}
