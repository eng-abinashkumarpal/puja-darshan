const form = document.getElementById('login-form');
const message = document.getElementById('message');
const adminArea = document.getElementById('admin-area');
const logoutButton = document.getElementById('logout-button');

const uploadForm = document.getElementById('upload-form');
const mediaFile = document.getElementById('media-file');
const uploadButton = document.getElementById('upload-button');
const uploadStatus = document.getElementById('upload-status');

const uploadToYoutube = document.getElementById('upload-to-youtube');
const youtubeOptions = document.getElementById('youtube-upload-options');
const youtubeTitle = document.getElementById('youtube-title');
const youtubeDescription = document.getElementById('youtube-description');
const youtubePrivacy = document.getElementById('youtube-privacy');

uploadToYoutube.addEventListener('change', () => {
  youtubeOptions.hidden = !uploadToYoutube.checked;
});

uploadForm.addEventListener('reset', () => {
  youtubeOptions.hidden = true;
});


const gallery = document.getElementById('media-gallery');
const galleryStatus = document.getElementById('gallery-status');
const refreshButton = document.getElementById('refresh-button');

const passwordChangeForm = document.getElementById('password-change-form');
const passwordChangeButton = document.getElementById('password-change-button');
const passwordChangeStatus = document.getElementById('password-change-status');


function showSignedIn(username) {
  form.hidden = true;
  adminArea.hidden = false;
  document.body.classList.add('admin-signed-in');
  document.getElementById('signed-in-as').textContent =
    `Signed in as ${username}.`;
  message.textContent = '';
  loadGallery();
  loadMandirs();
  loadSubmissions();
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401 && url !== '/api/auth/login') {
    adminArea.hidden = true;
    document.body.classList.remove('admin-signed-in');
    form.hidden = false;
    message.textContent = 'Your session expired. Please sign in again.';
    throw new Error('Authentication required.');
  }

  if (!response.ok) {
    throw new Error(data.error || 'Request failed. Please try again.');
  }

  return data;
}

async function checkSession() {
  try {
    const response = await fetch('/api/auth/me', {
      credentials: 'same-origin'
    });

    if (response.ok) {
      const data = await response.json();
      showSignedIn(data.username);
    }
  } catch {
    message.textContent = 'Unable to connect to the server.';
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  message.textContent = 'Signing in…';

  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  try {
    const data = await apiRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    document.getElementById('password').value = '';
    showSignedIn(username);
  } catch (error) {
    message.textContent = error.message;
  }
});

logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;

  try {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    adminArea.hidden = true;
    document.body.classList.remove('admin-signed-in');
    form.hidden = false;
    form.reset();
    gallery.replaceChildren();
    message.textContent = 'You have logged out.';
  } catch (error) {
    message.textContent = error.message;
  } finally {
    logoutButton.disabled = false;
  }
});


function readSelectedVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let finished = false;

    const finish = (error, duration) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;

      try {
        video.removeAttribute('src');
        video.load();
      } catch (_) {}

      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve(duration);
    };

    const timer = setTimeout(() => {
      finish(new Error('Could not read video duration. Try another video file.'));
    }, 30000);

    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = video.duration;
      if (Number.isFinite(duration) && duration > 0) {
        finish(null, duration);
      } else {
        finish(new Error('Could not verify the video duration.'));
      }
    };
    video.onerror = () => {
      finish(new Error('Could not read this video. Try MP4, MOV or WebM.'));
    };
    video.src = url;
    video.load();
  });
}

function uploadMediaWithProgress(body, alsoUpload) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open('POST', '/api/admin/media', true);
    xhr.withCredentials = true;
    xhr.timeout = 30 * 60 * 1000;

    xhr.upload.addEventListener('progress', event => {
      if (!event.lengthComputable) {
        uploadStatus.textContent =
          'Uploading file from this device… Keep this page open.';
        return;
      }

      const percent = Math.round((event.loaded / event.total) * 100);
      const sent = (event.loaded / (1024 * 1024)).toFixed(1);
      const total = (event.total / (1024 * 1024)).toFixed(1);

      uploadStatus.textContent =
        (alsoUpload ? 'Sending video for YouTube upload: '
                    : 'Sending media to Cloudinary: ') +
        percent + '% (' + sent + ' / ' + total +
        ' MB). Keep this page open.';
    });

    xhr.upload.addEventListener('load', () => {
      uploadStatus.textContent = alsoUpload
        ? 'Video sent to server. YouTube upload is processing; keep this page open.'
        : 'Files sent to server. Cloudinary is processing; keep this page open.';
    });

    xhr.addEventListener('load', () => {
      let result = {};
      try {
        result = JSON.parse(xhr.responseText || '{}');
      } catch (_) {}

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(result);
      } else {
        reject(new Error(
          result.error || 'Upload failed (HTTP ' + xhr.status + ').'
        ));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error(
        'Network error during upload. Check your connection and try again.'
      ));
    });

    xhr.addEventListener('timeout', () => {
      reject(new Error(
        'Upload timed out. A resumable upload system is needed for reliable retries.'
      ));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error('Upload was cancelled.'));
    });

    xhr.send(body);
  });
}

uploadForm.addEventListener('submit', async event => {
  event.preventDefault();

  const files = Array.from(mediaFile.files);
  const alsoUpload = uploadToYoutube.checked;

  if (files.length === 0) {
    uploadStatus.textContent = 'Please select at least one file.';
    return;
  }

  if (files.length > 10) {
    uploadStatus.textContent = 'You can upload up to 10 files at once.';
    return;
  }

  const maxFileSize = (alsoUpload ? 500 : 50) * 1024 * 1024;
  const oversizedFile = files.find(file => file.size > maxFileSize);

  if (oversizedFile) {
    const limitLabel = alsoUpload
      ? '500 MB YouTube upload limit'
      : '50 MB Cloudinary upload limit';

    uploadStatus.textContent =
      oversizedFile.name + ' exceeds the ' + limitLabel + '.';
    return;
  }

  if (alsoUpload && files.length !== 1) {
    uploadStatus.textContent =
      'For YouTube, select exactly one video at a time.';
    return;
  }

  if (alsoUpload) {
    const selected = files[0];
    const mimeAllowed =
      /^video\/(mp4|quicktime|webm)$/i.test(selected.type || '');
    const extensionAllowed =
      /\.(mp4|mov|webm)$/i.test(selected.name || '');

    if (!mimeAllowed && !extensionAllowed) {
      uploadStatus.textContent =
        'Choose an MP4, MOV or WebM video for YouTube upload.';
      return;
    }

    let duration = null;

    try {
      duration = await readSelectedVideoDuration(selected);
    } catch (error) {
      const proceed = window.confirm(
        'This device could not read the video duration. ' +
        'Continue only if the video is at least 5 minutes long. ' +
        'Videos under 8 minutes may not qualify for mid-roll ads. Continue?'
      );

      if (!proceed) {
        uploadStatus.textContent = 'Upload cancelled.';
        return;
      }
    }

    if (duration !== null) {
      const label =
        Math.floor(duration / 60) + ':' +
        String(Math.floor(duration % 60)).padStart(2, '0');

      if (duration < 300) {
        uploadStatus.textContent =
          'YouTube upload requires at least 5 minutes. Selected: ' +
          label + '.';
        return;
      }

      if (duration < 480 && !window.confirm(
        'This video is ' + label + ' long. ' +
        'Eligible monetized videos need at least 8 minutes for mid-roll ads. ' +
        'Continue uploading?'
      )) {
        uploadStatus.textContent = 'Upload cancelled.';
        return;
      }
    }
  }

  if (alsoUpload && youtubeTitle.value.trim().length > 100) {
    uploadStatus.textContent = 'YouTube title must be 100 characters or fewer.';
    return;
  }

  if (alsoUpload && youtubeDescription.value.length > 5000) {
    uploadStatus.textContent =
      'YouTube description must be 5000 characters or fewer.';
    return;
  }

  uploadButton.disabled = true;
  uploadStatus.textContent = alsoUpload
    ? 'Uploading directly to YouTube only… Please wait.'
    : 'Uploading ' + files.length + ' file(s) to Cloudinary… Please wait.';

  const body = new FormData();
  for (const file of files) body.append('files', file);

  body.append('alsoUploadToYoutube', alsoUpload ? 'true' : 'false');

  if (alsoUpload) {
    body.append('youtubeTitle', youtubeTitle.value.trim());
    body.append('youtubeDescription', youtubeDescription.value);
    body.append('youtubePrivacy', youtubePrivacy.value);
  }

  try {
    const result = await uploadMediaWithProgress(body, alsoUpload);

    if (!alsoUpload) {
      uploadStatus.textContent =
        'Upload successful! ' + result.count + ' file(s) uploaded to Cloudinary.';
    } else if (result.youtube && result.youtube.success === true) {
      uploadStatus.textContent =
        'YouTube upload successful! No video copy was saved to Cloudinary. ' +
        result.youtube.url +
        ' (Privacy: ' + result.youtube.privacyStatus + ').';
    } else if (result.youtube && result.youtube.success === false) {
      uploadStatus.textContent =
        'YouTube upload failed. No Cloudinary copy was saved. ' +
        (result.youtube.error || 'Please check the YouTube connection.');
    } else {
      uploadStatus.textContent =
        'No YouTube upload result was returned. Check the backend logs.';
    }

    uploadForm.reset();
    youtubeOptions.hidden = true;
    await loadGallery();
  } catch (error) {
    uploadStatus.textContent = 'Upload failed: ' + error.message;
  } finally {
    uploadButton.disabled = false;
  }
});

function createMediaCard(item) {
  const card = document.createElement('article');
  card.className = 'media-card';

  let preview;

  if (item.resource_type === 'video') {
    preview = document.createElement('video');
    preview.controls = true;
    preview.preload = 'metadata';
    preview.src = item.secure_url;
  } else {
    preview = document.createElement('img');
    preview.src = item.secure_url;
    preview.alt = 'Puja Darshan gallery media';
    preview.loading = 'lazy';
  }

  const name = document.createElement('p');
  name.className = 'media-name';
  name.textContent = `${item.public_id} (${item.format || 'media'})`;

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'danger';
  removeButton.textContent = 'Delete';

  removeButton.addEventListener('click', async () => {
    const confirmed = window.confirm(
      'Delete this media permanently from Cloudinary?'
    );

    if (!confirmed) return;

    removeButton.disabled = true;
    galleryStatus.textContent = 'Deleting media…';

    try {
      await apiRequest('/api/admin/media', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          public_id: item.public_id,
          resource_type: item.resource_type
        })
      });

      card.remove();
      galleryStatus.textContent = 'Media deleted successfully.';
    } catch (error) {
      galleryStatus.textContent = error.message;
      removeButton.disabled = false;
    }
  });

  card.append(preview, name, removeButton);
  return card;
}

async function loadGallery() {
  galleryStatus.textContent = 'Loading gallery…';
  refreshButton.disabled = true;

  try {
    const data = await apiRequest('/api/admin/media');
    gallery.replaceChildren();

    if (!data.media || data.media.length === 0) {
      galleryStatus.textContent = 'No media uploaded yet.';
      return;
    }

    for (const item of data.media) {
      gallery.appendChild(createMediaCard(item));
    }

    galleryStatus.textContent =
      `Showing ${data.media.length} media item(s).`;
  } catch (error) {
    galleryStatus.textContent = error.message;
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener('click', loadGallery);



// Mandir management UI.
const mandirForm = document.getElementById('mandir-form');
const mandirList = document.getElementById('mandir-list');
const mandirStatus = document.getElementById('mandir-status');
const pendingSubmissionList = document.getElementById('pending-submission-list');
const pendingSubmissionStatus = document.getElementById('pending-submission-status');
const refreshSubmissionsButton = document.getElementById('refresh-submissions-button');
const saveMandirButton = document.getElementById('save-mandir-button');
const cancelMandirEditButton = document.getElementById('cancel-mandir-edit');

function resetMandirForm() {
  mandirForm.reset();
  document.getElementById('mandir-id').value = '';
  saveMandirButton.textContent = 'Add Mandir';
  cancelMandirEditButton.hidden = true;
}

function createMandirAdminCard(item) {
  const card = document.createElement('article');
  card.className = 'mandir-admin-card';

  const title = document.createElement('h4');
  title.textContent = item.name;
  const district = document.createElement('p');
  district.textContent = 'District: ' + item.district;
  card.append(title, district);

  if (item.address) {
    const address = document.createElement('p');
    address.textContent = 'Address: ' + item.address;
    card.appendChild(address);
  }
  if (item.zone) {
    const zone = document.createElement('p');
    zone.textContent = 'Division / Zone: ' + item.zone;
    card.appendChild(zone);
  }
  if (item.latitude !== undefined && item.latitude !== '' &&
      item.longitude !== undefined && item.longitude !== '') {
    const map = document.createElement('a');
    map.href = 'https://www.google.com/maps?q=' +
      encodeURIComponent(item.latitude + ',' + item.longitude);
    map.target = '_blank';
    map.rel = 'noopener noreferrer';
    map.textContent = 'View temple map';
    card.appendChild(map);
  }
  if (item.description) {
    const description = document.createElement('p');
    description.textContent = item.description;
    card.appendChild(description);
  }
  if (item.imageUrl) {
    const image = document.createElement('img');
    image.src = item.imageUrl;
    image.alt = item.name;
    image.loading = 'lazy';
    image.className = 'mandir-admin-image';
    image.addEventListener('error', () => { image.hidden = true; });
    card.appendChild(image);
  }

  const actions = document.createElement('div');
  actions.className = 'mandir-card-actions';
  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.className = 'secondary';
  editButton.textContent = 'Edit';
  editButton.addEventListener('click', () => {
    document.getElementById('mandir-id').value = item.id;
    document.getElementById('mandir-name').value = item.name || '';
    document.getElementById('mandir-district').value = item.district || '';
    document.getElementById('mandir-zone').value = item.zone || '';
    document.getElementById('mandir-latitude').value = item.latitude || '';
    document.getElementById('mandir-longitude').value = item.longitude || '';
    document.getElementById('mandir-address').value = item.address || '';
    document.getElementById('mandir-image-url').value = item.imageUrl || '';
    document.getElementById('mandir-description').value = item.description || '';
    saveMandirButton.textContent = 'Save changes';
    cancelMandirEditButton.hidden = false;
    mandirStatus.textContent = 'Editing: ' + item.name;
    mandirForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'danger';
  deleteButton.textContent = 'Delete';
  deleteButton.addEventListener('click', async () => {
    if (!window.confirm('Delete "' + item.name + '" from the Mandir directory?')) return;
    deleteButton.disabled = true;
    mandirStatus.textContent = 'Deleting Mandir…';
    try {
      await apiRequest('/api/admin/mandirs/' + encodeURIComponent(item.id), { method: 'DELETE' });
      mandirStatus.textContent = 'Mandir deleted successfully.';
      if (document.getElementById('mandir-id').value === item.id) resetMandirForm();
      await loadMandirs();
    } catch (error) {
      mandirStatus.textContent = error.message;
      deleteButton.disabled = false;
    }
  });
  actions.append(editButton, deleteButton);
  card.appendChild(actions);
  return card;
}


function createSubmissionAdminCard(item) {
  const card = document.createElement('article');
  card.className = 'mandir-admin-card';

  function addText(tag, value) {
    if (!value) return;
    const element = document.createElement(tag);
    element.textContent = value;
    card.appendChild(element);
  }

  addText('h4', item.name);
  addText('p', 'District: ' + (item.district || ''));
  addText('p', 'Address: ' + (item.address || 'Not provided'));
  addText('p', item.description || 'No description provided.');
  addText('p', 'Submitted: ' + (item.submittedAt || ''));
  addText('p', 'Division / Zone: ' + (item.zone || 'Not provided'));

  function addReviewMapLink(label, latitude, longitude) {
    if (latitude == null || longitude == null ||
        String(latitude).trim() === '' || String(longitude).trim() === '') return;

    const line = document.createElement('p');
    line.appendChild(document.createTextNode(label + ': '));
    const link = document.createElement('a');
    link.href = 'https://www.google.com/maps?q=' +
      encodeURIComponent(latitude + ',' + longitude);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open map';
    line.appendChild(link);
    card.appendChild(line);
  }

  addReviewMapLink('Temple map location', item.latitude, item.longitude);

  if (item.submitterLocation) {
    addReviewMapLink(
      'Submitter-shared GPS (admin review only)',
      item.submitterLocation.latitude,
      item.submitterLocation.longitude
    );
    addText('p', 'Location accuracy: ' +
      (item.submitterLocation.accuracy == null
        ? 'Not provided'
        : Math.round(item.submitterLocation.accuracy) + ' metres'));
  }

  if (item.imageUrl) {
    const image = document.createElement('img');
    image.src = item.imageUrl;
    image.alt = item.name || 'Submitted mandir image';
    image.loading = 'lazy';
    image.className = 'mandir-admin-image';
    image.addEventListener('error', () => { image.hidden = true; });
    card.appendChild(image);
  }

  const actions = document.createElement('div');
  actions.className = 'mandir-card-actions';

  const approve = document.createElement('button');
  approve.type = 'button';
  approve.textContent = 'Approve & Publish';

  const reject = document.createElement('button');
  reject.type = 'button';
  reject.className = 'danger';
  reject.textContent = 'Reject';

  approve.addEventListener('click', async () => {
    if (!window.confirm('Approve and publish "' + item.name + '"?')) return;
    approve.disabled = true;
    reject.disabled = true;
    pendingSubmissionStatus.textContent = 'Approving submission…';

    try {
      const result = await apiRequest(
        '/api/admin/mandir-submissions/' + encodeURIComponent(item.id) + '/approve',
        { method: 'POST' }
      );
      await Promise.all([loadSubmissions(), loadMandirs()]);
      pendingSubmissionStatus.textContent =
        'Approved and published: ' + result.mandir.name;
    } catch (error) {
      pendingSubmissionStatus.textContent = error.message;
      approve.disabled = false;
      reject.disabled = false;
    }
  });

  reject.addEventListener('click', async () => {
    if (!window.confirm('Reject and remove "' + item.name + '" from the review queue?')) return;
    approve.disabled = true;
    reject.disabled = true;
    pendingSubmissionStatus.textContent = 'Rejecting submission…';

    try {
      await apiRequest(
        '/api/admin/mandir-submissions/' + encodeURIComponent(item.id),
        { method: 'DELETE' }
      );
      await loadSubmissions();
      pendingSubmissionStatus.textContent = 'Submission rejected.';
    } catch (error) {
      pendingSubmissionStatus.textContent = error.message;
      approve.disabled = false;
      reject.disabled = false;
    }
  });

  actions.append(approve, reject);
  card.appendChild(actions);
  return card;
}

async function loadSubmissions() {
  pendingSubmissionList.replaceChildren();
  pendingSubmissionStatus.textContent = 'Loading submissions…';

  try {
    const data = await apiRequest('/api/admin/mandir-submissions');
    const submissions = Array.isArray(data.submissions) ? data.submissions : [];

    if (submissions.length === 0) {
      pendingSubmissionStatus.textContent = 'No pending submissions.';
      return;
    }

    for (const item of submissions) {
      pendingSubmissionList.appendChild(createSubmissionAdminCard(item));
    }

    pendingSubmissionStatus.textContent =
      'Pending submissions: ' + submissions.length;
  } catch (error) {
    pendingSubmissionStatus.textContent = error.message;
  }
}

refreshSubmissionsButton.addEventListener('click', loadSubmissions);

async function loadMandirs() {
  mandirList.replaceChildren();
  mandirStatus.textContent = 'Loading Mandirs…';
  try {
    const data = await apiRequest('/api/mandirs');
    const mandirs = Array.isArray(data.mandirs) ? data.mandirs : [];
    if (mandirs.length === 0) {
      mandirStatus.textContent = 'No Mandirs added yet.';
      return;
    }
    for (const item of mandirs) mandirList.appendChild(createMandirAdminCard(item));
    mandirStatus.textContent = 'Showing ' + mandirs.length + ' Mandir(s).';
  } catch (error) {
    mandirStatus.textContent = error.message;
  }
}

mandirForm.addEventListener('submit', async event => {
  event.preventDefault();
  const id = document.getElementById('mandir-id').value;
  const payload = {
    name: document.getElementById('mandir-name').value,
    district: document.getElementById('mandir-district').value,
    zone: document.getElementById('mandir-zone').value,
    latitude: document.getElementById('mandir-latitude').value,
    longitude: document.getElementById('mandir-longitude').value,
    address: document.getElementById('mandir-address').value,
    imageUrl: document.getElementById('mandir-image-url').value,
    description: document.getElementById('mandir-description').value
  };
  saveMandirButton.disabled = true;
  mandirStatus.textContent = id ? 'Saving Mandir changes…' : 'Adding Mandir…';
  try {
    await apiRequest(id ? '/api/admin/mandirs/' + encodeURIComponent(id) : '/api/admin/mandirs', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    mandirStatus.textContent = id ? 'Mandir updated successfully.' : 'Mandir added successfully.';
    resetMandirForm();
    await loadMandirs();
  } catch (error) {
    mandirStatus.textContent = error.message;
  } finally {
    saveMandirButton.disabled = false;
  }
});

cancelMandirEditButton.addEventListener('click', () => {
  resetMandirForm();
  mandirStatus.textContent = 'Edit cancelled.';
});


passwordChangeForm.addEventListener('submit', async event => {
  event.preventDefault();

  const currentPassword = document.getElementById('current-admin-password').value;
  const newPassword = document.getElementById('new-admin-password').value;
  const confirmPassword = document.getElementById('confirm-admin-password').value;
  const passwordBytes = new TextEncoder().encode(newPassword).length;

  if (newPassword !== confirmPassword) {
    passwordChangeStatus.textContent = 'The new passwords do not match.';
    return;
  }

  if (passwordBytes < 12 || passwordBytes > 72) {
    passwordChangeStatus.textContent =
      'New password must be 12–72 UTF-8 bytes.';
    return;
  }

  if (currentPassword === newPassword) {
    passwordChangeStatus.textContent =
      'Choose a new password different from the current one.';
    return;
  }

  passwordChangeButton.disabled = true;
  passwordChangeStatus.textContent = 'Changing password…';

  try {
    await apiRequest('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword })
    });

    passwordChangeForm.reset();
    adminArea.hidden = true;
    document.body.classList.remove('admin-signed-in');
    form.hidden = false;
    form.reset();
    gallery.replaceChildren();
    message.textContent =
      'Password changed successfully. Please sign in with your new password.';
  } catch (error) {
    passwordChangeStatus.textContent = error.message;
  } finally {
    passwordChangeButton.disabled = false;
  }
});

checkSession();