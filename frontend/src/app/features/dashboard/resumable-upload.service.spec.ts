import { buildUploadFileKey } from './resumable-upload.service';

describe('buildUploadFileKey', () => {
  it('creates a stable key from file identity fields', () => {
    const file = new File(['hello'], 'promo.mp4', { type: 'video/mp4', lastModified: 12345 });
    Object.defineProperty(file, 'lastModified', { value: 12345 });
    Object.defineProperty(file, 'size', { value: 5 });

    expect(buildUploadFileKey(file)).toBe('promo.mp4:5:12345');
  });
});
