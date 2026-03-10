const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('fs-extra');
const request = require('supertest');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-play-backend-'));
const frontendDistDir = path.join(tmpRoot, 'frontend');

fs.ensureDirSync(frontendDistDir);
fs.writeFileSync(path.join(frontendDistDir, 'index.html'), '<html><body>ok</body></html>');

process.env.DB_FILE = path.join(tmpRoot, 'db.json');
process.env.UPLOADS_DIR = path.join(tmpRoot, 'uploads');
process.env.FRONTEND_DIST_DIR = frontendDistDir;
process.env.JWT_SECRET = 'test-secret';
process.env.MAX_UPLOAD_SIZE_MB = '512';
process.env.MEDIA_TRANSCODE_ENABLED = 'false';

const { createApp } = require('../dist/app');

const app = createApp();

test.after(async () => {
  await fs.remove(tmpRoot);
});

test('GET /api/health returns healthy state', async () => {
  const response = await request(app).get('/api/health');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    status: 'healthy',
  });
});

test('auth and system status flow works', async () => {
  const loginResponse = await request(app).post('/api/auth/login').send({
    password: 'admin',
    username: 'admin',
  });

  assert.equal(loginResponse.status, 200);
  assert.ok(loginResponse.body.token);

  const unauthorized = await request(app).get('/api/system/status');
  assert.equal(unauthorized.status, 401);

  const authorized = await request(app)
    .get('/api/system/status')
    .set('Authorization', `Bearer ${loginResponse.body.token}`);

  assert.equal(authorized.status, 200);
  assert.equal(typeof authorized.body.online, 'boolean');
  assert.ok(Array.isArray(authorized.body.localIps));
});

test('video upload and profile lifecycle work end-to-end', async () => {
  const loginResponse = await request(app).post('/api/auth/login').send({
    password: 'admin',
    username: 'admin',
  });
  const authHeader = { Authorization: `Bearer ${loginResponse.body.token}` };

  const uploadResponse = await request(app)
    .post('/api/videos')
    .set(authHeader)
    .attach('video', Buffer.from('fake mp4 content'), {
      contentType: 'video/mp4',
      filename: 'promo.mp4',
    });

  assert.equal(uploadResponse.status, 200);
  assert.equal(uploadResponse.body.originalName, 'promo.mp4');

  const createProfileResponse = await request(app)
    .post('/api/profiles')
    .set(authHeader)
    .send({
      name: 'Lobby Screen',
      videoIds: [uploadResponse.body.id],
    });

  assert.equal(createProfileResponse.status, 200);
  assert.equal(createProfileResponse.body.slug, 'lobby-screen');
  assert.equal(createProfileResponse.body.videos.length, 1);

  const publicProfile = await request(app).get('/api/profiles/slug/lobby-screen');
  assert.equal(publicProfile.status, 200);
  assert.equal(publicProfile.body.name, 'Lobby Screen');

  const videosResponse = await request(app).get('/api/videos').set(authHeader);
  assert.equal(videosResponse.status, 200);
  assert.equal(videosResponse.body[0].usageCount, 1);
  assert.equal(videosResponse.body[0].processingStatus, 'ready');

  const policyResponse = await request(app).get('/api/videos/policy').set(authHeader);
  assert.equal(policyResponse.status, 200);
  assert.equal(policyResponse.body.maxUploadSizeBytes, 512 * 1024 * 1024);
  assert.equal(policyResponse.body.mediaProcessingEnabled, false);

  const streamResponse = await request(app)
    .get(`/api/videos/${uploadResponse.body.id}/stream`)
    .set('Range', 'bytes=0-3');
  assert.equal(streamResponse.status, 206);
  assert.match(streamResponse.headers['content-range'], /^bytes 0-3\//);

  const heartbeatResponse = await request(app).post(
    `/api/profiles/${createProfileResponse.body.id}/heartbeat`,
  );
  assert.equal(heartbeatResponse.status, 200);

  const deleteVideoResponse = await request(app)
    .delete(`/api/videos/${uploadResponse.body.id}`)
    .set(authHeader);
  assert.equal(deleteVideoResponse.status, 200);

  const updatedProfile = await request(app).get(`/api/profiles/${createProfileResponse.body.id}`);
  assert.equal(updatedProfile.status, 200);
  assert.equal(updatedProfile.body.videos.length, 0);

  const deleteProfileResponse = await request(app)
    .delete(`/api/profiles/${createProfileResponse.body.id}`)
    .set(authHeader);
  assert.equal(deleteProfileResponse.status, 200);
});

test('resumable upload sessions accept chunks and assemble a video', async () => {
  const loginResponse = await request(app).post('/api/auth/login').send({
    password: 'admin',
    username: 'admin',
  });
  const authHeader = { Authorization: `Bearer ${loginResponse.body.token}` };
  const fileBuffer = Buffer.from('abcdefghijklmnopqrstuvwxyz');

  const sessionResponse = await request(app)
    .post('/api/videos/uploads/sessions')
    .set(authHeader)
    .send({
      fileKey: 'promo.mov:26:123',
      mimeType: 'video/quicktime',
      originalName: 'promo.mov',
      totalSizeBytes: fileBuffer.length,
    });

  assert.equal(sessionResponse.status, 200);
  assert.equal(sessionResponse.body.totalChunks, 1);

  const chunkResponse = await request(app)
    .put(`/api/videos/uploads/sessions/${sessionResponse.body.id}/chunks/0`)
    .set(authHeader)
    .set('Content-Type', 'application/octet-stream')
    .send(fileBuffer);

  assert.equal(chunkResponse.status, 200);
  assert.deepEqual(chunkResponse.body.uploadedChunkIndexes, [0]);

  const resumedSession = await request(app)
    .get(`/api/videos/uploads/sessions/${sessionResponse.body.id}`)
    .set(authHeader);
  assert.equal(resumedSession.status, 200);
  assert.deepEqual(resumedSession.body.uploadedChunkIndexes, [0]);

  const completeResponse = await request(app)
    .post(`/api/videos/uploads/sessions/${sessionResponse.body.id}/complete`)
    .set(authHeader);

  assert.equal(completeResponse.status, 200);
  assert.equal(completeResponse.body.originalName, 'promo.mov');
  assert.equal(completeResponse.body.sourceSize, fileBuffer.length);
});
