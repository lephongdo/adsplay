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

  private activityTimeout: any;
  private heartbeatInterval: any;
  private autoReloadTimeout: any;
  private heartbeatFailures = 0;

  @ViewChild('videoPlayer') videoPlayer!: ElementRef<HTMLVideoElement>;
  @ViewChild('bgVideo') bgVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('container') container!: ElementRef<HTMLDivElement>;

  currentVideoSrc = computed(() => {
    const p = this.profile();
    if (!p || !p.videos || p.videos.length === 0) return '';
    const video = p.videos[this.currentVideoIndex()];
    return `/uploads/${video.filename}`;
  });

  private onFullscreenChangeBound = () => {
    this.zone.run(() => {
      this.isFullscreen.set(!!document.fullscreenElement);
    });
  }

  // Mouse move event bound outside of Angular Zone to prevent massive CPU spiking
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

      // Memory Leak Prevention: Hard reload the digital signage every 24 hours
      this.autoReloadTimeout = setTimeout(() => {
        window.location.reload();
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

  onMetadataLoaded(event: any) {
    const video = event.target as HTMLVideoElement;
    if (video) {
      this.isVideoPortrait.set(video.videoHeight > video.videoWidth);
      this.playVideo();
    }
  }

  // Prevents the player from freezing if a video file is corrupted or missing
  onVideoError(event: any) {
    console.error("Video failed to load or play. Skipping to next to prevent freeze.", event);
    this.onVideoEnded();
  }

  async playVideo() {
    if (!this.videoPlayer) return;

    try {
      this.videoPlayer.nativeElement.muted = false;
      const playPromise = this.videoPlayer.nativeElement.play();
      if (this.bgVideo && this.bgVideo.nativeElement) {
        this.bgVideo.nativeElement.currentTime = 0;
        this.bgVideo.nativeElement.play().catch(() => { });
      }
      await playPromise;
      this.showUnmuteOverlay.set(false);
    } catch (err) {
      console.warn("Autoplay with sound failed, falling back to muted", err);
      this.videoPlayer.nativeElement.muted = true;
      try {
        const fallbackPromise = this.videoPlayer.nativeElement.play();
        if (this.bgVideo && this.bgVideo.nativeElement) {
          this.bgVideo.nativeElement.currentTime = 0;
          this.bgVideo.nativeElement.play().catch(() => { });
        }
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
    this.videoPlayer.nativeElement.play().catch(e => console.error("Unmute play failed", e));
    if (this.bgVideo && this.bgVideo.nativeElement) {
      this.bgVideo.nativeElement.play().catch(() => { });
    }
    this.showUnmuteOverlay.set(false);
  }

  onVideoEnded() {
    const p = this.profile();
    if (!p || !p.videos || p.videos.length === 0) return;

    let nextIndex = this.currentVideoIndex() + 1;

    if (nextIndex >= p.videos.length) {
      console.log('Playlist ended, checking for updates...');
      this.api.getProfile(p.id).subscribe({
        next: (updatedProfile) => {
          this.profile.set(updatedProfile);

          if (updatedProfile.videos && updatedProfile.videos.length > 0) {
            this.currentVideoIndex.set(0);
            if (updatedProfile.videos.length === 1) {
              if (this.videoPlayer && this.videoPlayer.nativeElement) {
                this.videoPlayer.nativeElement.currentTime = 0;
                this.videoPlayer.nativeElement.play().catch(e => console.error("Play failed on loop", e));
              }
            }
          } else {
            console.warn('Playlist became empty after update. Redirecting to selection.');
            this.backToSelection();
          }
        },
        error: (err) => {
          console.error('Failed to auto-update playlist, looping local copy', err);
          this.currentVideoIndex.set(0);
          // @ts-ignore
          if (p.videos.length === 1) {
            if (this.videoPlayer && this.videoPlayer.nativeElement) {
              this.videoPlayer.nativeElement.currentTime = 0;
              this.videoPlayer.nativeElement.play().catch(e => console.error("Play failed on fallback loop", e));
            }
          }
        }
      });
    } else {
      this.currentVideoIndex.set(nextIndex);
    }
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  backToSelection() {
    this.profile.set(null);
    this.router.navigate(['/player']);
  }
}