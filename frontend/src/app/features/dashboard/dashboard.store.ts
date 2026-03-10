import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { forkJoin, interval, of } from 'rxjs';
import { catchError, finalize, startWith, switchMap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService, Profile, Video } from '../../services/api.service';
import { ToastService } from '../../shared/services/toast.service';
import { getErrorMessage } from '../../shared/utils/error-message';
import { ResumableUploadService } from './resumable-upload.service';

export interface SaveProfilePayload {
  id?: string;
  name: string;
  videoIds: string[];
}

@Injectable()
export class DashboardStore {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly resumableUpload = inject(ResumableUploadService);
  private readonly toastService = inject(ToastService);

  readonly videos = signal<Video[]>([]);
  readonly profiles = signal<Profile[]>([]);
  readonly loading = signal(false);
  readonly isUploading = signal(false);
  readonly uploadProgress = signal(0);
  readonly uploadStatusLabel = signal('San sang tai len');
  readonly isSystemOnline = signal(true);
  readonly systemInfo = signal<{ uptime: number; localIps: string[] } | null>(null);
  readonly maxUploadSizeBytes = signal(2 * 1024 * 1024 * 1024);
  readonly activePlayerCount = computed(() => this.profiles().filter((profile) => this.isOnline(profile.lastSeen)).length);

  initialize() {
    this.refreshAll();
    this.startSystemPolling();
    this.loadVideoPolicy();
  }

  refreshAll() {
    this.loading.set(true);

    forkJoin({
      profiles: this.api.getProfiles(),
      videos: this.api.getVideos(),
    })
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ profiles, videos }) => {
          this.profiles.set(profiles);
          this.videos.set(videos);
        },
        error: (error) => {
          this.toastService.show(getErrorMessage(error, 'Khong the tai du lieu dashboard.'), 'error');
        },
      });
  }

  startSystemPolling() {
    interval(30000)
      .pipe(
        startWith(0),
        switchMap(() =>
          this.api.getSystemStatus().pipe(
            catchError(() => {
              this.isSystemOnline.set(false);
              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((status) => {
        if (!status) {
          return;
        }

        this.isSystemOnline.set(status.online);
        this.systemInfo.set({ localIps: status.localIps, uptime: status.uptime });
      });
  }

  async uploadVideo(file: File) {
    this.isUploading.set(true);
    this.uploadProgress.set(0);
    this.uploadStatusLabel.set('Dang tao phien tai len...');

    try {
      await this.resumableUpload.uploadFile(file, (progressPercent, session) => {
        this.uploadProgress.set(progressPercent);
        this.uploadStatusLabel.set(
          session.uploadedChunkIndexes.length > 0
            ? `Dang tiep tuc tai len (${session.uploadedChunkIndexes.length}/${session.totalChunks} chunks da co)`
            : 'Dang tai len theo tung chunk...',
        );
      });

      this.toastService.show('Video da duoc tai len thanh cong.', 'success');
      this.refreshAll();
    } catch (error) {
      this.toastService.show(getErrorMessage(error, 'Tai video that bai.'), 'error');
    } finally {
      this.isUploading.set(false);
      this.uploadProgress.set(0);
      this.uploadStatusLabel.set('San sang tai len');
    }
  }

  loadVideoPolicy() {
    this.api
      .getVideoPolicy()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (policy) => {
          this.maxUploadSizeBytes.set(policy.maxUploadSizeBytes);
        },
        error: () => undefined,
      });
  }

  saveProfile(payload: SaveProfilePayload) {
    const request = payload.id
      ? this.api.updateProfile(payload.id, payload.name, payload.videoIds)
      : this.api.createProfile(payload.name, payload.videoIds);

    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toastService.show(
          payload.id ? 'Da cap nhat man hinh.' : 'Da tao man hinh moi.',
          'success',
        );
        this.refreshAll();
      },
      error: (error) => {
        this.toastService.show(getErrorMessage(error, 'Khong the luu man hinh.'), 'error');
      },
    });
  }

  deleteProfile(id: string) {
    this.api
      .deleteProfile(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.show('Da xoa man hinh.', 'success');
          this.refreshAll();
        },
        error: (error) => {
          this.toastService.show(getErrorMessage(error, 'Khong the xoa man hinh.'), 'error');
        },
      });
  }

  deleteVideo(id: string) {
    this.api
      .deleteVideo(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.show('Da xoa video.', 'success');
          this.refreshAll();
        },
        error: (error) => {
          this.toastService.show(getErrorMessage(error, 'Khong the xoa video.'), 'error');
          this.refreshAll();
        },
      });
  }

  getVideoDeleteMessage(id: string) {
    const usedInProfiles = this.profiles().filter((profile) => profile.videoIds.includes(id));
    if (!usedInProfiles.length) {
      return 'Hanh dong nay khong the hoan tac. Video se bi xoa vinh vien khoi he thong.';
    }

    const profileNames = usedInProfiles.map((profile) => profile.name).join(', ');
    return `Video nay dang duoc dung trong: ${profileNames}. Xoa video se lam playlist cua cac man hinh do mat noi dung ngay lap tuc.`;
  }

  isOnline(lastSeen?: string) {
    if (!lastSeen) {
      return false;
    }

    return Date.now() - new Date(lastSeen).getTime() < 60000;
  }
}
