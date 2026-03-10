import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getConfig } from '../config';
import { AppError } from '../errors';
import { dbRepository } from '../db';

const config = getConfig();

export const login = async (username: string, password: string) => {
    const dbUser = await dbRepository.findUserByUsername(username);

    let isValid = false;
    if (dbUser) {
        isValid = await bcrypt.compare(password, dbUser.passwordHash);
    } else if (username === config.adminUsername && password === config.adminPassword) {
        isValid = true;
    }

    if (!isValid) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials.');
    }

    return jwt.sign({ username }, config.jwtSecret, { expiresIn: '24h' });
};
