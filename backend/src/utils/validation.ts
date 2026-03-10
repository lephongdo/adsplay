import { AppError } from '../errors';

export const requireNonEmptyString = (
    value: unknown,
    field: string,
    maxLength = 120,
) => {
    if (typeof value !== 'string') {
        throw new AppError(400, 'VALIDATION_ERROR', `${field} must be a string.`);
    }

    const trimmed = value.trim();
    if (!trimmed) {
        throw new AppError(400, 'VALIDATION_ERROR', `${field} is required.`);
    }

    if (trimmed.length > maxLength) {
        throw new AppError(400, 'VALIDATION_ERROR', `${field} must be at most ${maxLength} characters.`);
    }

    return trimmed;
};

export const requireOptionalString = (value: unknown, field: string) => {
    if (value == null) {
        return undefined;
    }

    if (typeof value !== 'string') {
        throw new AppError(400, 'VALIDATION_ERROR', `${field} must be a string.`);
    }

    return value;
};

export const requireStringArray = (value: unknown, field: string) => {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw new AppError(400, 'VALIDATION_ERROR', `${field} must be an array of strings.`);
    }

    return [...new Set(value)];
};
