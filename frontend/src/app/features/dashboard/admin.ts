import { Component, OnInit, OnDestroy, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpEvent, HttpEventType } from '@angular/common/http';
import { ApiService, Video, Profile } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { Button } from '../../shared/ui/button/button';
import { ThemeToggle } from '../../shared/ui/theme-toggle/theme-toggle';
import { VideoList } from './components/video-list/video-list';
import { ProfileManager } from './components/profile-manager/profile-manager';
import { ConfirmModal } from '../../shared/ui/confirm-modal/confirm-modal';

@Component({
  selector: 'app-admin',
  imports: [CommonModule, VideoList, ProfileManager, ThemeToggle, ConfirmModal],
  templateUrl: './admin.html',
  styleUrl: './admin.css',
})
export class Admin implements OnInit, OnDestroy {
  activeTab: 'videos' | 'profiles' = 'videos';
  isMobileMenuOpen = signal<boolean>(false);
  videos = signal<Video[]>([]);
  profiles = signal<Profile[]>([]);
  loading = signal(false);
  isUploading = signal(false);
  uploadProgress = signal(0);

  // Modal State
  videoDeletingId = signal<string | null>(null);

  // Mock Logic for dashboard widgets
  isSystemOnline = signal(true);
  systemInfo = signal<{ uptime: number; localIps: string[] } | null>(null);
  playerUrl = signal('');
  copySuccess = signal(false);

  @HostListener('window:beforeunload', ['$event'])
  unloadNotification($event: any) {
    if (this.isUploading()) {
      $event.returnValue = 'Đang tải video lên. Hành động này sẽ hủy quá trình tải lên. Bạn có chắc chắn muốn rời khỏi trang này?';
    }
  }

  constructor(
    private api: ApiService,
    private authService: AuthService
  ) { }

  onLogout() {
    this.authService.logout();
  }

  ngOnInit() {
    this.refreshData();
    this.startStatusPolling();

    if (typeof window !== 'undefined') {
      this.playerUrl.set(`${window.location.origin}/player`);
    }
  }

  ngOnDestroy() {
    if (this.statusInterval) clearInterval(this.statusInterval);
  }

  private statusInterval: any;
  startStatusPolling() {
    this.checkSystemStatus();
    this.statusInterval = setInterval(() => {
      this.checkSystemStatus();
    }, 30000);
  }

  checkSystemStatus() {
    this.api.getSystemStatus().subscribe({
      next: (status) => {
        this.isSystemOnline.set(status.online);
        this.systemInfo.set({ uptime: status.uptime, localIps: status.localIps });
      },
      error: () => {
        this.isSystemOnline.set(false);
      }
    });
  }

  refreshData() {
    this.loading.set(true);
    this.api.getVideos().subscribe({
      next: (v) => {
        this.videos.set(v);
        this.checkLoading();
      },
      error: () => this.checkLoading()
    });
    this.api.getProfiles().subscribe({
      next: (p) => {
        this.profiles.set(p);
        this.checkLoading();
      },
      error: () => this.checkLoading()
    });
  }

  private loadCount = 0;
  private checkLoading() {
    this.loadCount++;
    if (this.loadCount >= 2) {
      this.loading.set(false);
      this.loadCount = 0;
    }
  }

  onUpload(file: File) {
    this.isUploading.set(true);
    this.uploadProgress.set(0);

    this.api.uploadVideo(file).subscribe({
      next: (event: HttpEvent<any>) => {
        if (event.type === HttpEventType.UploadProgress) {
          if (event.total) {
            const percentDone = Math.round(100 * event.loaded / event.total);
            this.uploadProgress.set(percentDone);
          }
        } else if (event.type === HttpEventType.Response) {
          this.isUploading.set(false);
          this.uploadProgress.set(0);
          this.refreshData();
        }
      },
      error: (err) => {
        console.error('Upload failed', err);
        this.isUploading.set(false);
        this.uploadProgress.set(0);
      }
    });
  }

  onDeleteVideo(id: string) {
    // 🚨 EDGE CASE FIX: Check if video is actively used in any profile
    const usedInProfiles = this.profiles().filter(p => p.videoIds && p.videoIds.includes(id));

    if (usedInProfiles.length > 0) {
      const profileNames = usedInProfiles.map(p => p.name).join(', ');
      const proceed = confirm(`CẢNH BÁO: Video này đang được sử dụng trong các profile: [${profileNames}].\n\nXóa video này sẽ lập tức làm mất nội dung trên các màn hình đang phát profile đó. Bạn có CHẮC CHẮN muốn tiếp tục xóa?`);

      if (!proceed) return; // Abort if they click cancel
    }

    // Proceed to open standard confirmation modal
    this.videoDeletingId.set(id);
  }

  confirmDeleteVideo() {
    const id = this.videoDeletingId();
    if (id) {
      // ⚡ OPTIMISTIC UI: Instantly remove video from the UI to prevent interactions while network processes
      this.videos.update(current => current.filter(v => v.id !== id));
      this.videoDeletingId.set(null); // Close modal instantly

      this.api.deleteVideo(id).subscribe({
        next: () => {
          this.refreshData(); // Sync truth from backend
        },
        error: (err) => {
          console.error('Lỗi khi xóa video', err);
          alert('Không thể xóa video. Khôi phục lại trạng thái cũ.');
          this.refreshData(); // Revert UI if it failed
        }
      });
    }
  }

  cancelDeleteVideo() {
    this.videoDeletingId.set(null);
  }

  copyUrl() {
    const url = this.playerUrl();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        this.showCopySuccess();
      }).catch(() => {
        this.fallbackCopyTextToClipboard(url);
      });
    } else {
      this.fallbackCopyTextToClipboard(url);
    }
  }

  private fallbackCopyTextToClipboard(text: string) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      const successful = document.execCommand('copy');
      if (successful) {
        this.showCopySuccess();
      }
    } catch (err) {
      console.error('Fallback copy failed', err);
    }
    document.body.removeChild(textArea);
  }

  private showCopySuccess() {
    this.copySuccess.set(true);
    setTimeout(() => {
      this.copySuccess.set(false);
    }, 2000);
  }
}