// src/utils/validation.js — input validators (reusable across routes)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateName(name) {
  if (typeof name !== 'string') return 'Name is required';
  const trimmed = name.trim();
  if (trimmed.length < 1) return 'Name is required';
  if (trimmed.length > 120) return 'Name must be 120 characters or less';
  return null;
}

function validateEmail(email) {
  if (typeof email !== 'string') return 'Email is required';
  const trimmed = email.trim();
  if (trimmed.length < 3) return 'Email is too short';
  if (trimmed.length > 254) return 'Email is too long';
  if (!EMAIL_RE.test(trimmed)) return 'Email format is invalid';
  return null;
}

function validatePassword(plain) {
  if (typeof plain !== 'string') return 'Password is required';
  if (plain.length < 8) return 'Password must be at least 8 characters';
  if (plain.length > 200) return 'Password is too long';
  return null;
}

module.exports = { validateName, validateEmail, validatePassword };
