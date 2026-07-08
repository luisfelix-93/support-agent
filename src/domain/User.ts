import { Password } from './Password.js';

export class User {
    constructor(
        public readonly id: string,
        public readonly name: string,
        public readonly email: string,
        public readonly password: Password,
        public readonly workspaceId: string[],
        public readonly createdAt: Date,
        public readonly updatedAt: Date
    ) { }
}
