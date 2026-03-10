import { dbRepository } from '../db';
import { AppError } from '../errors';
import type { DetailedProfile, Profile, Video } from '../types';
import { slugify } from '../utils/slugify';

const toVideoMap = (videos: Video[]) => new Map(videos.map((video) => [video.id, video] as const));

const withVideos = async (profile: Profile): Promise<DetailedProfile> => {
    const videos = await dbRepository.listVideos();
    const videosById = toVideoMap(videos);
    const mappedVideos = profile.videoIds
        .map((videoId) => videosById.get(videoId))
        .filter((video): video is Video => Boolean(video));

    return {
        ...profile,
        slug: slugify(profile.name),
        videos: mappedVideos,
    };
};

export const listProfiles = async () => {
    const profiles = await dbRepository.listProfiles();
    return profiles.map((profile) => ({
        ...profile,
        slug: slugify(profile.name),
    }));
};

export const getDetailedProfileById = async (id: string) => {
    const profile = await dbRepository.findProfileById(id);
    if (!profile) {
        throw new AppError(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
    }

    return withVideos(profile);
};

export const getDetailedProfileBySlug = async (profileSlug: string) => {
    const profile = await dbRepository.findProfileBySlug(profileSlug);
    if (!profile) {
        throw new AppError(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
    }

    return withVideos(profile);
};

export const saveProfile = async (input: { id?: string; name: string; videoIds: string[] }) => {
    const profiles = await dbRepository.listProfiles();
    if (input.id && !profiles.some((profile) => profile.id === input.id)) {
        throw new AppError(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
    }

    if (!input.videoIds.length) {
        throw new AppError(400, 'PROFILE_EMPTY_PLAYLIST', 'Profile must contain at least one video.');
    }

    const nextSlug = slugify(input.name);
    const duplicate = profiles.find(
        (profile) => profile.id !== input.id && slugify(profile.name) === nextSlug,
    );

    if (duplicate) {
        throw new AppError(409, 'PROFILE_SLUG_CONFLICT', 'Profile name already exists.');
    }

    const videos = await dbRepository.listVideos();
    const videosById = toVideoMap(videos);
    const missingVideo = input.videoIds.find((videoId) => !videosById.has(videoId));
    if (missingVideo) {
        throw new AppError(400, 'VIDEO_NOT_FOUND', `Video ${missingVideo} does not exist.`);
    }

    await dbRepository.upsertProfile(input);
    const savedProfile = input.id
        ? await dbRepository.findProfileById(input.id)
        : await dbRepository.findProfileBySlug(nextSlug);

    if (!savedProfile) {
        throw new AppError(500, 'PROFILE_SAVE_FAILED', 'Failed to save profile.');
    }

    return withVideos(savedProfile);
};

export const removeProfile = async (id: string) => {
    const deleted = await dbRepository.deleteProfile(id);
    if (!deleted) {
        throw new AppError(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
    }
};

export const markProfileHeartbeat = async (id: string) => {
    const profile = await dbRepository.findProfileById(id);
    if (!profile) {
        throw new AppError(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
    }

    await dbRepository.touchProfile(id, new Date().toISOString());
};
