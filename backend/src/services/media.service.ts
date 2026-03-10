import fs from 'fs-extra';
import path from 'node:path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { getConfig } from '../config';
import { dbRepository } from '../db';
import { logError, logInfo } from '../logger';
import type { Video } from '../types';

const config = getConfig();
const queue: string[] = [];
let isProcessing = false;

if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
}

if (ffprobeStatic.path) {
    ffmpeg.setFfprobePath(ffprobeStatic.path);
}

const probe = async (inputPath: string): Promise<Partial<Video>> =>
    new Promise((resolve, reject) => {
        ffmpeg.ffprobe(inputPath, (error, metadata) => {
            if (error) {
                reject(error);
                return;
            }

            const videoStream = metadata.streams.find((stream) => stream.codec_type === 'video');
            resolve({
                durationSeconds: metadata.format.duration || undefined,
                height: videoStream?.height,
                width: videoStream?.width,
            });
        });
    });

const transcodeToOptimizedMp4 = async (sourcePath: string, outputPath: string) =>
    new Promise<void>((resolve, reject) => {
        ffmpeg(sourcePath)
            .outputOptions([
                '-movflags +faststart',
                '-preset veryfast',
                '-crf 24',
                '-maxrate 3500k',
                '-bufsize 7000k',
                '-vf scale=w=1920:h=1080:force_original_aspect_ratio=decrease',
                '-pix_fmt yuv420p',
                '-profile:v high',
                '-level 4.1',
            ])
            .videoCodec('libx264')
            .audioCodec('aac')
            .audioBitrate('128k')
            .format('mp4')
            .on('end', () => resolve())
            .on('error', (error) => reject(error))
            .save(outputPath);
    });

const ensureUniqueProcessedPath = (videoId: string) =>
    path.join(config.processedUploadsDir, `${videoId}-optimized.mp4`);

const processNext = async () => {
    if (isProcessing || !queue.length) {
        return;
    }

    isProcessing = true;
    const videoId = queue.shift() as string;

    try {
        const video = await dbRepository.findVideoById(videoId);
        if (!video) {
            return;
        }

        await dbRepository.updateVideo(videoId, (draft) => {
            draft.processingStatus = 'processing';
            draft.processingError = undefined;
        });

        const sourcePath = path.join(config.uploadsDir, video.sourceFilename);
        const optimizedFilename = path.basename(ensureUniqueProcessedPath(video.id));
        const optimizedPath = path.join(config.processedUploadsDir, optimizedFilename);

        await transcodeToOptimizedMp4(sourcePath, optimizedPath);

        const [sourceStats, optimizedStats, mediaMetadata] = await Promise.all([
            fs.stat(sourcePath),
            fs.stat(optimizedPath),
            probe(optimizedPath),
        ]);

        if (optimizedStats.size >= sourceStats.size) {
            await fs.remove(optimizedPath);
            await dbRepository.updateVideo(videoId, (draft) => {
                draft.processingStatus = 'ready';
                draft.processingError = 'Giữ lại bản gốc vì file tối ưu không nhỏ hơn.';
                draft.streamVariant = 'original';
                draft.durationSeconds = mediaMetadata.durationSeconds || draft.durationSeconds;
                draft.height = mediaMetadata.height || draft.height;
                draft.width = mediaMetadata.width || draft.width;
            });
        } else {
            await dbRepository.updateVideo(videoId, (draft) => {
                draft.filename = path.join('processed', optimizedFilename);
                draft.mimeType = 'video/mp4';
                draft.processingStatus = 'ready';
                draft.processingError = undefined;
                draft.size = optimizedStats.size;
                draft.streamVariant = 'optimized';
                draft.durationSeconds = mediaMetadata.durationSeconds;
                draft.height = mediaMetadata.height;
                draft.width = mediaMetadata.width;
            });
        }

        logInfo('media.optimized', { videoId });
    } catch (error) {
        logError('media.optimize_failed', {
            error: error instanceof Error ? error.message : String(error),
            videoId,
        });
        await dbRepository.updateVideo(videoId, (draft) => {
            draft.processingStatus = 'ready';
            draft.processingError = 'Không thể tối ưu hóa video, đang dùng bản gốc.';
            draft.streamVariant = 'original';
        });
    } finally {
        isProcessing = false;
        if (queue.length) {
            void processNext();
        }
    }
};

export const enqueueVideoOptimization = async (videoId: string) => {
    if (!config.mediaProcessingEnabled) {
        return;
    }

    const video = await dbRepository.findVideoById(videoId);
    if (!video) {
        return;
    }

    try {
        const sourcePath = path.join(config.uploadsDir, video.sourceFilename);
        const sourceMetadata = await probe(sourcePath);
        await dbRepository.updateVideo(videoId, (draft) => {
            draft.durationSeconds = sourceMetadata.durationSeconds;
            draft.height = sourceMetadata.height;
            draft.width = sourceMetadata.width;
        });
    } catch (error) {
        logError('media.probe_failed', {
            error: error instanceof Error ? error.message : String(error),
            videoId,
        });
    }

    queue.push(videoId);
    await processNext();
};
