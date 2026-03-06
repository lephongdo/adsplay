import { Component, OnInit, OnDestroy, ViewChild, ElementRef, signal, computed, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService, Profile, Video } from '../../services/api.service';
import { slugify } from '../../shared/utils/slugify';

@Component({
  selector: 'app-player',
  imports: [CommonModule],
  templateUrl: './player.html',
  styleUrl: './player.css',
})
export class Player implements OnInit, OnDestroy {
  isFullscreen = signal(false);
  profile = signal<Profile | null>(null);
  allProfiles = signal<Profile[]>([]);
  currentVideoIndex = signal(0);
  loading = signal(true);
  showUnmuteOverlay = signal(false);
  isCursorHidden = signal(false);
  isVideoPortrait = signal(false);

  // NEW: Signal to hold the local Object URL for the video
  localVideoUrl = signal<string>('');
  private currentObjectUrl: string | null = null;

  private activityTimeout: any;
  private heartbeatInterval: any;
  private autoReloadTimeout: any;
  private heartbeatFailures = 0;

  @ViewChild('videoPlayer') videoPlayer!: ElementRef<HTMLVideoElement>;
  @ViewChild('container') container!: ElementRef<HTMLDivElement>;

  private endedSafetyTimeout: any;

  private onFullscreenChangeBound = () => {
    this.zone.run(() => {
      const fs = !!document.fullscreenElement;
      console.log(`Fullscreen state changed: ${fs ? 'ENTERED' : 'EXITED'}`);
      this.isFullscreen.set(fs);

      if (!fs && this.profile()) {
        this.isCursorHidden.set(false);
      }
    });
  }

  private onMouseMoveBound = () => {
    this.resetActivityTimer();
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private zone: NgZone
  ) { }

  ngOnInit() {
    this.route.params.subscribe(params => {
      const name = params['profileName'];
      if (name) {
        this.loadProfileByName(name);
      } else {
        this.loadAllProfiles();
      }
    });

    this.isFullscreen.set(!!document.fullscreenElement);

    this.zone.runOutsideAngular(() => {
      document.addEventListener('fullscreenchange', this.onFullscreenChangeBound);
      document.addEventListener('mousemove', this.onMouseMoveBound);
      document.addEventListener('click', this.onMouseMoveBound);

      this.autoReloadTimeout = setInterval(() => {
        if (!document.fullscreenElement) {
          console.log('Performing scheduled 24h reload...');
          window.location.reload();
        } else {
          console.log('Hard reload deferred: Player is currently in fullscreen.');
        }
      }, 24 * 60 * 60 * 1000);
    });

    this.resetActivityTimer();
    this.startHeartbeat();
  }

  ngOnDestroy() {
    document.removeEventListener('fullscreenchange', this.onFullscreenChangeBound);
    document.removeEventListener('mousemove', this.onMouseMoveBound);
    document.removeEventListener('click', this.onMouseMoveBound);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.activityTimeout) clearTimeout(this.activityTimeout);
    if (this.autoReloadTimeout) clearTimeout(this.autoReloadTimeout);

    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
    }

    if (this.videoPlayer && this.videoPlayer.nativeElement) {
      this.videoPlayer.nativeElement.pause();
      this.videoPlayer.nativeElement.src = "";
      this.videoPlayer.nativeElement.load();
    }
    if (this.endedSafetyTimeout) clearTimeout(this.endedSafetyTimeout);
  }

  private resetActivityTimer() {
    if (this.isCursorHidden()) {
      this.zone.run(() => {
        this.isCursorHidden.set(false);
      });
    }

    if (this.activityTimeout) clearTimeout(this.activityTimeout);

    if (this.profile()) {
      this.zone.runOutsideAngular(() => {
        this.activityTimeout = setTimeout(() => {
          this.zone.run(() => {
            this.isCursorHidden.set(true);
          });
        }, 3000);
      });
    }
  }

  startHeartbeat() {
    const sendPulse = () => {
      const p = this.profile();
      if (p && p.id) {
        this.api.sendHeartbeat(p.id).subscribe({
          next: () => {
            this.heartbeatFailures = 0;
          },
          error: (e) => {
            console.error('Heartbeat failed', e);
            this.heartbeatFailures++;

            if (this.heartbeatFailures >= 5) {
              console.warn('Heartbeat failed 5 times continuously. Stopping polling.');
              if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
            }
          }
        });
      }
    };

    this.heartbeatInterval = setInterval(sendPulse, 30000);
  }

  loadAllProfiles() {
    this.loading.set(true);
    this.api.getProfiles().subscribe({
      next: (profiles) => {
        this.allProfiles.set(profiles);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error loading profiles', err);
        this.loading.set(false);
      }
    });
  }

  loadProfileByName(name: string) {
    this.loading.set(true);
    this.api.getProfiles().subscribe({
      next: (profiles) => {
        const found = profiles.find(p => slugify(p.name) === name);
        if (found) {
          this.api.getProfile(found.id).subscribe({
            next: (detailedProfile) => {
              this.profile.set(detailedProfile);
              this.currentVideoIndex.set(0);
              this.loading.set(false);

              this.heartbeatFailures = 0;
              this.api.sendHeartbeat(found.id).subscribe();

              // Sync cache and start playing the first video
              if (detailedProfile.videos) {
                this.syncCacheWithBackend(detailedProfile.videos);
                this.loadAndPlayVideo(0);
              }
            },
            error: (e) => {
              console.error("Failed to load details", e);
              this.loading.set(false);
            }
          })
        } else {
          console.warn("Profile not found by name:", name);
          this.loading.set(false);
          this.router.navigate(['/player']);
        }
      },
      error: (err) => {
        console.error('Error loading profiles for lookup', err);
        this.loading.set(false);
      }
    });
  }

  // --- NEW: CACHING & MEMORY MANAGEMENT ---

  /**
   * Fetches the video from local cache. If it doesn't exist, downloads it.
   */
  private async loadAndPlayVideo(index: number) {
    const p = this.profile();
    if (!p || !p.videos || p.videos.length === 0) return;

    const video = p.videos[index];
    const serverUrl = `/uploads/${video.filename}`;

    try {
      const cache = await caches.open('adsplay-video-cache');
      let response = await cache.match(serverUrl);

      if (!response) {
        console.log(`Downloading ${video.filename} to local TV storage...`);
        response = await fetch(serverUrl);
        if (response.ok) {
          await cache.put(serverUrl, response.clone());
        }
      } else {
        console.log(`Playing ${video.filename} directly from TV storage (0 bandwidth)`);
      }

      const blob = await response.blob();

      if (this.currentObjectUrl) {
        URL.revokeObjectURL(this.currentObjectUrl);
      }

      this.currentObjectUrl = URL.createObjectURL(blob);
      this.localVideoUrl.set(this.currentObjectUrl);

    } catch (error) {
      console.error("Cache failed, falling back to network stream", error);
      this.localVideoUrl.set(serverUrl);
    }
  }

  /**
   * Prevents TV hard drives from filling up by deleting old, removed videos
   */
  private async syncCacheWithBackend(validVideos: Video[]) {
    try {
      const cache = await caches.open('adsplay-video-cache');
      const cachedRequests = await cache.keys();
      const validFilenames = validVideos.map(v => v.filename);

      for (const request of cachedRequests) {
        const urlParts = request.url.split('/');
        const cachedFilename = urlParts[urlParts.length - 1];

        // If the video on the hard drive is NO LONGER in the backend playlist, delete it.
        if (!validFilenames.includes(cachedFilename)) {
          console.log(`🧹 Garbage Collector: Deleting old video to free up TV space: ${cachedFilename}`);
          await cache.delete(request);
        }
      }
    } catch (e) {
      console.error("Cache cleanup failed", e);
    }
  }

  // ----------------------------------------

  selectProfile(p: Profile) {
    try {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
          console.warn("Auto-fullscreen denied:", err);
        });
      }
    } catch (e) {
      console.warn("Fullscreen API error:", e);
    }
    this.router.navigate(['/player', slugify(p.name)]);
  }

  onVideoEnded() {
    clearTimeout(this.endedSafetyTimeout);
    this.next();
  }

  private startEndedSafetyTimer() {
    clearTimeout(this.endedSafetyTimeout);
    const duration = this.videoPlayer?.nativeElement?.duration;
    if (duration && !isNaN(duration)) {
      this.endedSafetyTimeout = setTimeout(() => {
        if (!this.videoPlayer.nativeElement.paused) {
          console.warn("Ended event missed, forcing next video via safety timer");
          this.onVideoEnded();
        }
      }, (duration + 2) * 1000);
    }
  }

  onMetadataLoaded(event: any) {
    this.startEndedSafetyTimer();
    const video = event.target as HTMLVideoElement;
    if (video) {
      this.isVideoPortrait.set(video.videoHeight > video.videoWidth);
      this.playVideo();
    }
  }

  onVideoError(event: any) {
    console.error("Video failed to load or play. Skipping to next to prevent freeze.", event);
    this.onVideoEnded();
  }

  async playVideo() {
    if (!this.videoPlayer) return;

    try {
      this.videoPlayer.nativeElement.muted = false;
      const playPromise = this.videoPlayer.nativeElement.play();
      await playPromise;
      this.showUnmuteOverlay.set(false);
    } catch (err) {
      console.warn("Autoplay with sound failed, falling back to muted", err);
      this.videoPlayer.nativeElement.muted = true;
      try {
        const fallbackPromise = this.videoPlayer.nativeElement.play();
        await fallbackPromise;
        this.showUnmuteOverlay.set(true);
      } catch (e) {
        console.error("Autoplay failed completely", e);
      }
    }
  }

  interact() {
    this.unmuteAndPlay();
    if (!this.isFullscreen()) {
      this.toggleFullscreen();
    }
  }

  unmuteAndPlay() {
    if (!this.videoPlayer) return;
    this.videoPlayer.nativeElement.muted = false;
    this.videoPlayer.nativeElement.play().catch((e: any) => console.error("Unmute play failed", e));
    this.showUnmuteOverlay.set(false);
  }

  private next() {
    const p = this.profile();
    if (!p || !p.videos || p.videos.length === 0) return;

    let nextIndex = this.currentVideoIndex() + 1;

    // Check backend for updates when we reach the end of the playlist
    if (nextIndex >= p.videos.length) {
      console.log('Playlist ended, checking backend for updates...');
      this.api.getProfile(p.id).subscribe({
        next: (updatedProfile) => {
          this.profile.set(updatedProfile);

          if (updatedProfile.videos && updatedProfile.videos.length > 0) {
            // Clean up the cache against the NEW list of videos
            this.syncCacheWithBackend(updatedProfile.videos);

            this.currentVideoIndex.set(0);
            this.loadAndPlayVideo(0); // Load via Cache Manager
          } else {
            console.warn('Playlist became empty after update. Redirecting to selection.');
            this.backToSelection();
          }
        },
        error: (err) => {
          console.error('Failed to auto-update playlist, looping local copy', err);
          this.currentVideoIndex.set(0);
          this.loadAndPlayVideo(0); // Load via Cache Manager
        }
      });
    } else {
      this.currentVideoIndex.set(nextIndex);
      this.loadAndPlayVideo(nextIndex); // Load via Cache Manager
    }
  }

  toggleFullscreen() {
    const elem = this.container.nativeElement as any;
    if (!document.fullscreenElement && !(document as any).webkitFullscreenElement && !(document as any).mozFullScreenElement && !(document as any).msFullscreenElement) {
      if (elem.requestFullscreen) {
        elem.requestFullscreen();
      } else if (elem.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen();
      } else if (elem.mozRequestFullScreen) {
        elem.mozRequestFullScreen();
      } else if (elem.msRequestFullscreen) {
        elem.msRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      } else if ((document as any).mozCancelFullScreen) {
        (document as any).mozCancelFullScreen();
      } else if ((document as any).msExitFullscreen) {
        (document as any).msExitFullscreen();
      }
    }
  }

  backToSelection() {
    this.profile.set(null);
    this.router.navigate(['/player']);
  }
}