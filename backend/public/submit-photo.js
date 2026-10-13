'use strict';

const form = document.getElementById('photo-submit-form');
const fileInput = document.getElementById('photo-file');
const statusBox = document.getElementById('photo-submit-status');
const submitButton = form.querySelector('button[type="submit"]');

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];

  if (!file) return;

  if (!ALLOWED_TYPES.has(file.type)) {
    fileInput.value = '';
    statusBox.textContent = 'Please select a JPG, PNG or WebP image.';
    return;
  }

  if (file.size > MAX_BYTES) {
    fileInput.value = '';
    statusBox.textContent = 'Image must be 5 MB or smaller.';
    return;
  }

  statusBox.textContent = 'Selected: ' + file.name;
});

form.addEventListener('submit', async event => {
  event.preventDefault();

  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    statusBox.textContent = 'Please select a photo.';
    return;
  }

  if (!ALLOWED_TYPES.has(file.type) || file.size > MAX_BYTES) {
    statusBox.textContent = 'Choose a JPG, PNG or WebP image up to 5 MB.';
    return;
  }

  if (!form.elements.rightsConsent.checked) {
    statusBox.textContent = 'Please confirm that you have permission to share this photo.';
    return;
  }

  const data = new FormData(form);
  submitButton.disabled = true;
  statusBox.textContent = 'Submitting photo for review…';

  try {
    const response = await fetch('/api/photo-submissions', {
      method: 'POST',
      credentials: 'same-origin',
      body: data
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || 'Photo submission failed. Please try again.');
    }

    form.reset();
    statusBox.textContent =
      result.message || 'Photo submitted. It will remain private until approved.';
  } catch (error) {
    statusBox.textContent = error.message || 'Network error. Please try again.';
  } finally {
    submitButton.disabled = false;
  }
});
