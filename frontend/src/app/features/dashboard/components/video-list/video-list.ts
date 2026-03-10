import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Video } from '../../../../services/api.service';

@Component({
  selector: 'app-video-list',
  imports: [CommonModule, FormsModule],
  templateUrl: './video-list.html',
  styleUrl: './video-list.css',
})
export class VideoList {
  @Input() videos: Video[] = [];
  @Input() isUploading = false;
  @Input() uploadProgress = 0;
  @Input() maxUploadSizeBytes = 2 * 1024 * 1024 * 1024;
  @Input() uploadStatusLabel = 'San sang tai len';
  @Output() upload = new EventEmitter<File>();
  @Output() delete = new EventEmitter<string>();

  uploadError: string | null = null;
  query = '';
  sortBy: 'largest' | 'most-used' | 'name' | 'newest' = 'newest';

  private readonly ALLOWED_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];

  get filteredVideos() {
    const query = this.query.trim().toLowerCase();
    const items = this.videos.filter((video) => {
      if (!query) {
        return true;
      }

      return (
        video.originalName.toLowerCase().includes(query) ||
        video.filename.toLowerCase().includes(query)
      );
    });

    return items.sort((left, right) => {
      switch (this.sortBy) {
        case 'largest':
          return right.size - left.size;
        case 'most-used':
          return (right.usageCount || 0) - (left.usageCount || 0);
        case 'name':
          return left.originalName.localeCompare(right.originalName);
        case 'newest':
        default:
          return new Date(right.uploadedAt).getTime() - new Date(left.uploadedAt).getTime();
      }
    });
  }

  onFileSelected(event: Event) {
    this.uploadError = null;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    if (!this.ALLOWED_TYPES.includes(file.type)) {
      this.uploadError = `Dinh dang khong ho tro (${file.type || 'unknown'}). Chon MP4, WebM, OGG hoac MOV.`;
      input.value = '';
      return;
    }

    if (file.size > this.maxUploadSizeBytes) {
      const sizeInMB = (file.size / (1024 * 1024)).toFixed(2);
      this.uploadError = `File qua lon (${sizeInMB} MB). Gioi han hien tai la ${this.getMaxUploadSizeLabel()}.`;
      input.value = '';
      return;
    }

    this.upload.emit(file);
    input.value = '';
  }

  formatUploadedAt(value: string) {
    return new Date(value).toLocaleString();
  }

  getProcessingLabel(video: Video) {
    if (video.processingStatus === 'processing') {
      return 'Dang toi uu';
    }

    if (video.processingStatus === 'pending') {
      return 'Dang xep hang';
    }

    return video.streamVariant === 'optimized' ? 'San sang HD' : 'San sang ban goc';
  }

  getMaxUploadSizeLabel() {
    return `${(this.maxUploadSizeBytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }
}
