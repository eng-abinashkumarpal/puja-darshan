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
  loadMandirs();
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401 && url !== '/api/auth/login') {
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

  const files = Array.from(mediaFile.files);

  if (files.length === 0) {
    uploadStatus.textContent = 'Please select at least one file.';
    return;
  }

  if (files.length > 10) {
    uploadStatus.textContent = 'You can upload up to 10 files at once.';
    return;
  }

  const oversizedFile = files.find(file => file.size > 50 * 1024 * 1024);

  if (oversizedFile) {
    uploadStatus.textContent =
      `${oversizedFile.name} exceeds the 50 MB limit.`;
    return;
  }

  uploadButton.disabled = true;
  uploadStatus.textContent = `Uploading ${files.length} file(s)… Please wait.`;

  const body = new FormData();

  for (const file of files) {
    body.append('files', file);
  }

  try {
    const data = await apiRequest('/api/admin/media', {
      method: 'POST',
      body
    });

    uploadStatus.textContent =
      `Upload successful! ${data.count} file(s) uploaded.`;

    uploadForm.reset();
    await loadGallery();
  } catch (error) {
    uploadStatus.textContent = `Upload failed: ${error.message}`;
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

checkSession();