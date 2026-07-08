import { randomUUID } from 'crypto';
import { IUserRepository } from '../domain/ports/IUserRepository.js';
import { User } from '../domain/User.js';
import { Password } from '../domain/Password.js';

interface RegisterUserInput {
    name: string;
    email: string;
    password: string;
    role: string;
}

export class RegisterUserUseCase {
    constructor(private readonly userRepository: IUserRepository) {}

    async execute(input: RegisterUserInput): Promise<{ id: string }> {
        const existing = await this.userRepository.findByEmail(input.email);
        if (existing) {
            throw new Error('Email already registered.');
        }

        const now = new Date();
        const user = new User(
            randomUUID(),
            input.name,
            input.email,
            Password.create(input.password),
            undefined,
            input.role,
            now,
            now
        );

        await this.userRepository.save(user);
        return { id: user.id };
    }
}
