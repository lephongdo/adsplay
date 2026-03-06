import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Button } from '../../../../shared/ui/button/button';
import { Video, Profile, ApiService } from '../../../../services/api.service';
import { ConfirmModal } from '../../../../shared/ui/confirm-modal/confirm-modal';
import { slugify } from '../../../../shared/utils/slugify';

@Component({
  selector: 'app-profile-manager',
  imports: [CommonModule, FormsModule, ConfirmModal],
  templateUrl: './profile-manager.html',
  styleUrl: './profile-manager.css',
})
export class ProfileManager {
  @Input() profiles: Profile[] = [];
  @Input() videos: Video[] = [];

  isEditing = false;
  editingId: string | null = null;
  profileName = '';
  mobileTab: 'library' | 'playlist' = 'library';

  videoDeletingId = null;
  deletingProfileId: string | null = null;

  playlistVideos: Video[] = [];

  draggedIndex: number | null = null;
  draggedVideo: Video | null = null;
  isDragOverPlaylist = false;

  constructor(private api: ApiService) { }

  openCreate() {
    this.isEditing = true;
    this.editingId = null;
    this.profileName = '';
    this.playlistVideos = [];
  }

  openEdit(profile: Profile) {
    this.isEditing = true;
    this.editingId = profile.id;
    this.profileName = profile.name;

    this.playlistVideos = profile.videoIds
      .map(id => this.videos.find(v => v.id === id))
      .filter((v): v is Video => !!v);
  }

  @Output() refresh = new EventEmitter<void>();

  addToPlaylist(video: Video) {
    this.playlistVideos.push(video);
  }

  removeFromPlaylist(index: number) {
    this.playlistVideos.splice(index, 1);
  }

  onDragStartFromLibrary(event: DragEvent, video: Video) {
    this.draggedVideo = video;
    this.draggedIndex = null;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('text/plain', 'library');
    }
  }

  onDragStart(event: DragEvent, index: number) {
    this.draggedIndex = index;
    this.draggedVideo = null;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', index.toString());
    }
  }

  onDragOver(event: DragEvent, index?: number) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = this.draggedVideo ? 'copy' : 'move';
    }
    this.isDragOverPlaylist = true;
  }

  onDragLeave() {
    this.isDragOverPlaylist = false;
  }

  onDrop(event: DragEvent, index?: number) {
    event.preventDefault();
    this.isDragOverPlaylist = false;

    if (this.draggedVideo) {
      const targetIndex = index !== undefined ? index : this.playlistVideos.length;
      this.playlistVideos.splice(targetIndex, 0, this.draggedVideo);
      this.draggedVideo = null;
    }
    else if (this.draggedIndex !== null) {
      const targetIndex = index !== undefined ? index : this.playlistVideos.length - 1;
      const movedItem = this.playlistVideos[this.draggedIndex];
      this.playlistVideos.splice(this.draggedIndex, 1);
      this.playlistVideos.splice(targetIndex, 0, movedItem);
      this.draggedIndex = null;
    }
  }

  save() {
    const name = this.profileName.trim();
    if (!name) {
      alert('Vui lòng nhập tên cho Profile.');
      return;
    }

    // 🚨 EDGE CASE FIX: Prevent saving empty profiles causing black screens on TVs
    if (this.playlistVideos.length === 0) {
      alert('Không thể lưu! Vui lòng thêm ít nhất 1 video vào playlist.');
      return;
    }

    // 🚨 EDGE CASE FIX: Prevent Duplicate Names / Slug Collision
    const slugifiedNewName = slugify(name);
    const isDuplicate = this.profiles.some(p =>
      p.id !== this.editingId && slugify(p.name) === slugifiedNewName
    );

    if (isDuplicate) {
      alert('Tên profile này đã tồn tại hoặc tạo ra đường dẫn trùng lặp. Vui lòng chọn một tên khác.');
      return;
    }

    const videoIds = this.playlistVideos.map(v => v.id);

    const obs = this.editingId
      ? this.api.updateProfile(this.editingId, name, videoIds)
      : this.api.createProfile(name, videoIds);

    obs.subscribe({
      next: () => {
        this.isEditing = false;
        this.refresh.emit(); // Tell admin dashboard to fetch updated lists
      },
      error: (err) => {
        console.error('Lỗi khi lưu profile', err);
        alert('Đã xảy ra lỗi hệ thống khi lưu profile.');
      }
    });
  }

  cancel() {
    this.isEditing = false;
  }

  deleteProfile(id: string) {
    this.deletingProfileId = id;
  }

  confirmDelete() {
    if (this.deletingProfileId) {
      const targetId = this.deletingProfileId;

      // ⚡ OPTIMISTIC UI: Remove it instantly so it disappears without waiting for backend
      this.profiles = this.profiles.filter(p => p.id !== targetId);
      this.deletingProfileId = null; // Close modal instantly

      this.api.deleteProfile(targetId).subscribe({
        next: () => {
          this.refresh.emit(); // Sync to make sure UI and backend match
        },
        error: (err) => {
          console.error('Lỗi xóa profile', err);
          alert('Không thể xóa profile. Khôi phục trạng thái cũ.');
          this.refresh.emit(); // Revert UI if network failed
        }
      });
    }
  }

  cancelDelete() {
    this.deletingProfileId = null;
  }

  getPlayerUrl(name: string): string {
    return `${window.location.origin}/player/${slugify(name)}`;
  }

  isOnline(lastSeen?: string): boolean {
    if (!lastSeen) return false;
    const diff = Date.now() - new Date(lastSeen).getTime();
    return diff < 60000;
  }
}