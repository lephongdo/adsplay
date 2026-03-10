import { Injectable, inject } from '@angular/core';
import { firstValueFrom, lastValueFrom } from 'rxjs';
import { ApiService, UploadSession, Video } from '../../services/api.service';

export const buildUploadFileKey = (file: File) =>
  `${file.name}:${file.size}:${file.lastModified}`;

@Injectable({
  providedIn: 'root',
})
export class ResumableUploadService {
  private readonly api = inject(ApiService);

  async uploadFile(
    file: File,
    onProgress: (progressPercent: number, session: UploadSession) => void,
  ): Promise<Video> {
    const session = await firstValueFrom(
      this.api.createUploadSession({
        fileKey: buildUploadFileKey(file),
        mimeType: file.type,
        originalName: file.name,
        totalSizeBytes: file.size,
      }),
    );

    const uploadedChunkIndexes = new Set(session.uploadedChunkIndexes);
    let uploadedBytes = this.getUploadedBytes(file, session, uploadedChunkIndexes);
    onProgress(Math.round((uploadedBytes / file.size) * 100), session);

    for (let chunkIndex = 0; chunkIndex < session.totalChunks; chunkIndex += 1) {
      if (uploadedChunkIndexes.has(chunkIndex)) {
        continue;
      }

      const chunkStart = chunkIndex * session.chunkSizeBytes;
      const chunkEnd = Math.min(chunkStart + session.chunkSizeBytes, file.size);
      const chunk = file.slice(chunkStart, chunkEnd);

      await lastValueFrom(this.api.uploadChunk(session.id, chunkIndex, chunk));

      // HttpClient with fetch does not emit incremental upload progress reliably,
      // so advance after each committed chunk.
      uploadedBytes += chunk.size;
      uploadedChunkIndexes.add(chunkIndex);
      session.uploadedChunkIndexes = [...uploadedChunkIndexes].sort((left, right) => left - right);
      onProgress(Math.round((uploadedBytes / file.size) * 100), session);
    }

    return firstValueFrom(this.api.completeUploadSession(session.id));
  }

  private getUploadedBytes(file: File, session: UploadSession, uploadedChunkIndexes: Set<number>) {
    let uploadedBytes = 0;
    for (const chunkIndex of uploadedChunkIndexes) {
      const chunkStart = chunkIndex * session.chunkSizeBytes;
      const chunkEnd = Math.min(chunkStart + session.chunkSizeBytes, file.size);
      uploadedBytes += chunkEnd - chunkStart;
    }
    return uploadedBytes;
  }
}
