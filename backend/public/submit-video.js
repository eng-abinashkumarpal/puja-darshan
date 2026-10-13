(() => {
  'use strict';

  const API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? location.origin : 'https://puja-darshan-api.onrender.com';
  const MAX_BYTES = 1024 * 1024 * 1024;
  const CHUNK_SIZE = 20 * 1024 * 1024;

  const form = document.getElementById('video-submit-form');
  const fileInput = document.getElementById('video-file');
  const button = document.getElementById('video-submit-button');
  const status = document.getElementById('video-upload-status');
  const progress = document.getElementById('video-upload-progress');

  async function postJson(endpoint, payload) {
    const response = await fetch(API + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store'
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Request failed. Please try again.');
    }
    return data;
  }

  function uploadPart(file, start, end, signing, uploadId, completedBytes) {
    return new Promise((resolve, reject) => {
      const chunk = file.slice(start, end, file.type || 'application/octet-stream');
      const body = new FormData();

      body.append('file', chunk, file.name);
      body.append('api_key', signing.api_key);
      body.append('timestamp', String(signing.timestamp));
      body.append('signature', signing.signature);
      body.append('folder', signing.folder);
      body.append('public_id', signing.public_id);
      body.append('tags', signing.tags);
      body.append('type', signing.type);

      const xhr = new XMLHttpRequest();
      const chunked = file.size > 50 * 1024 * 1024;
      xhr.open('POST',
        'https://api.cloudinary.com/v1_1/' +
        encodeURIComponent(signing.cloud_name) + '/video/upload',
        true
      );
      xhr.timeout = 15 * 60 * 1000;

      if (chunked) {
        xhr.setRequestHeader('X-Unique-Upload-Id', uploadId);
        xhr.setRequestHeader(
          'Content-Range',
          'bytes ' + start + '-' + (end - 1) + '/' + file.size
        );
      }

      xhr.upload.addEventListener('progress', event => {
        if (!event.lengthComputable) return;
        const current = Math.min(end - start, event.loaded);
        const sent = completedBytes + current;
        progress.value = Math.min(100, Math.round(sent / file.size * 100));
        status.textContent =
          'Uploading video: ' + progress.value + '% (' +
          (sent / (1024 * 1024)).toFixed(1) + ' MB of ' +
          (file.size / (1024 * 1024)).toFixed(1) + ' MB). Keep this page open.';
      });

      xhr.addEventListener('load', () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText || '{}'); } catch (_) {}

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
        } else {
          reject(new Error(
            data.error && data.error.message
              ? data.error.message
              : 'Cloudinary upload failed (HTTP ' + xhr.status + ').'
          ));
        }
      });

      xhr.addEventListener('error', () =>
        reject(new Error('Network error while uploading a video chunk. Check your connection and retry.'))
      );
      xhr.addEventListener('timeout', () =>
        reject(new Error('A video chunk timed out. Check your connection and submit again.'))
      );

      xhr.send(body);
    });
  }

  async function uploadToCloudinary(file, initial, website) {
    let completedBytes = 0;
    let lastResult = null;
    const chunked = file.size > 50 * 1024 * 1024;
    const chunkSize = chunked ? CHUNK_SIZE : file.size;

    for (let start = 0; start < file.size; start += chunkSize) {
      const end = Math.min(start + chunkSize, file.size);
      let partResult = null;
      let lastError = null;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          let signing;

          if (start === 0 && attempt === 0) {
            signing = initial;
          } else {
            signing = await postJson('/api/video-submissions/refresh-signature', {
              ticketId: initial.ticketId,
              website
            });
          }

          partResult = await uploadPart(
            file, start, end, signing, initial.uploadId, completedBytes
          );
          break;
        } catch (error) {
          lastError = error;
          if (attempt === 2) throw error;
          status.textContent =
            'A chunk failed. Retrying (' + (attempt + 1) + '/2)… Keep this page open.';
        }
      }

      if (!partResult) throw lastError || new Error('Chunk upload failed.');

      completedBytes = end;
      lastResult = partResult;
      status.textContent =
        'Uploaded ' + (completedBytes / (1024 * 1024)).toFixed(1) +
        ' MB of ' + (file.size / (1024 * 1024)).toFixed(1) + ' MB.';
    }

    if (!lastResult || !lastResult.public_id) {
      throw new Error('Upload finished without a Cloudinary video ID.');
    }
    return lastResult;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();

    const file = fileInput.files && fileInput.files[0];
    const extension = file ? file.name.toLowerCase().match(/\.(mp4|mov|webm)$/) : null;

    if (!file) {
      status.textContent = 'Choose a video file first.';
      return;
    }
    if (file.size > MAX_BYTES) {
      status.textContent = 'The selected video exceeds the 1 GB limit.';
      return;
    }
    if (!extension || file.size < 1) {
      status.textContent = 'Choose a valid MP4, MOV or WebM video.';
      return;
    }
    if (!document.getElementById('video-rights-consent').checked) {
      status.textContent = 'Publication permission is required.';
      return;
    }

    button.disabled = true;
    progress.value = 0;
    status.textContent = 'Starting a secure upload…';

    const website = document.getElementById('video-website').value;

    try {
      const ticket = await postJson('/api/video-submissions/sign-upload', {
        fileName: file.name,
        fileSize: file.size,
        website
      });

      const asset = await uploadToCloudinary(file, ticket, website);

      status.textContent = 'Upload complete. Sending submission for review…';
      const submission = await postJson('/api/video-submissions', {
        ticketId: ticket.ticketId,
        public_id: asset.public_id,
        title: document.getElementById('video-title').value.trim(),
        description: document.getElementById('video-description').value.trim(),
        mandirName: document.getElementById('video-mandir').value.trim(),
        district: document.getElementById('video-district').value.trim(),
        submitterName: document.getElementById('video-submitter').value.trim(),
        contact: document.getElementById('video-contact').value.trim(),
        rightsConsent: document.getElementById('video-rights-consent').checked,
        website
      });

      progress.value = 100;
      status.textContent =
        'Submission received successfully. It is private and awaits admin review. Reference: ' +
        submission.submissionId;
      form.reset();
    } catch (error) {
      status.textContent =
        'Upload or submission failed: ' + error.message +
        ' If the video already uploaded, contact the site admin before retrying.';
    } finally {
      button.disabled = false;
    }
  });
})();
