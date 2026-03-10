import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getConfig } from '../config';
import { AppError } from '../errors';

const config = getConfig();

export interface AuthenticatedRequest extends Request {
    user?: string | jwt.JwtPayload;
}

export const authenticateToken = (
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction,
) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];

    if (!token) {
        return next(new AppError(401, 'AUTH_REQUIRED', 'Authentication is required.'));
    }

    try {
        req.user = jwt.verify(token, config.jwtSecret);
        next();
    } catch {
        next(new AppError(403, 'AUTH_INVALID', 'Authentication token is invalid.'));
    }
};
