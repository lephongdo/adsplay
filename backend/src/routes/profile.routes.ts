import { Router } from 'express';
import { asyncHandler } from '../errors';
import { authenticateToken } from '../middleware/auth';
import {
    getDetailedProfileById,
    getDetailedProfileBySlug,
    listProfiles,
    markProfileHeartbeat,
    removeProfile,
    saveProfile,
} from '../services/profile.service';
import { requireOptionalString, requireStringArray, requireNonEmptyString } from '../utils/validation';

export const profileRouter = Router();

profileRouter.get(
    '/',
    asyncHandler(async (_req, res) => {
        const profiles = await listProfiles();
        res.setHeader('Cache-Control', 'public, max-age=15');
        res.json(profiles);
    }),
);

profileRouter.get(
    '/slug/:slug',
    asyncHandler(async (req, res) => {
        const profile = await getDetailedProfileBySlug(requireNonEmptyString(req.params.slug, 'slug'));
        res.setHeader('Cache-Control', 'public, max-age=15');
        res.json(profile);
    }),
);

profileRouter.get(
    '/:id',
    asyncHandler(async (req, res) => {
        const profile = await getDetailedProfileById(requireNonEmptyString(req.params.id, 'id'));
        res.setHeader('Cache-Control', 'public, max-age=15');
        res.json(profile);
    }),
);

profileRouter.post(
    '/',
    authenticateToken,
    asyncHandler(async (req, res) => {
        const name = requireNonEmptyString(req.body?.name, 'name');
        const videoIds = requireStringArray(req.body?.videoIds, 'videoIds');
        const id = requireOptionalString(req.body?.id, 'id');
        const profile = await saveProfile({ id, name, videoIds });
        res.json(profile);
    }),
);

profileRouter.delete(
    '/:id',
    authenticateToken,
    asyncHandler(async (req, res) => {
        await removeProfile(requireNonEmptyString(req.params.id, 'id'));
        res.json({ success: true });
    }),
);

profileRouter.post(
    '/:id/heartbeat',
    asyncHandler(async (req, res) => {
        await markProfileHeartbeat(requireNonEmptyString(req.params.id, 'id'));
        res.json({ success: true });
    }),
);
