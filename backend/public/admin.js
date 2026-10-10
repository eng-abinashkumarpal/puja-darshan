const form = document.getElementById('login-form');
const message = document.getElementById('message');
const adminArea = document.getElementById('admin-area');
const logoutButton = document.getElementById('logout-button');

const uploadForm = document.getElementById('upload-form');
const mediaFile = document.getElementById('media-file');
const uploadButton = document.getElementById('upload-button');
const uploadStatus = document.getElementById('upload-status');

const gallery = document.getElementById('media-gallery');
const galleryStatus = document.getElementById('gallery-status');
const refreshButton = document.getElementById('refresh-button');

function showSignedIn(username) {
  form.hidden = true;
  adminArea.hidden = false;
  document.getElementById('signed-in-as').textContent =
    `Signed in as ${username}.`;
  message.textContent = '';
  loadGallery();
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    adminArea.hidden = true;
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

uploadForm.addEventListener('submit', async event => {
  event.preventDefault();

  const file = mediaFile.files[0];

  if (!file) {
    uploadStatus.textContent = 'Please select a file first.';
    return;
  }

  if (file.size > 50 * 1024 * 1024) {
    uploadStatus.textContent = 'File size must not exceed 50 MB.';
    return;
  }

  uploadButton.disabled = true;
  uploadStatus.textContent = 'Uploading… Please wait.';

  const body = new FormData();
  body.append('file', file);

  try {
    await apiRequest('/api/admin/media', {
      method: 'POST',
      body
    });

    uploadStatus.textContent = 'Upload successful!';
    uploadForm.reset();
    await loadGallery();
  } catch (error) {
    uploadStatus.textContent = error.message;
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

checkSession();