// src/utils/password.js — bcrypt helpers
const bcrypt = require('bcrypt');

const ROUNDS = 12;

async function hash(plain) {
  if (typeof plain !== 'string' || plain.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  return bcrypt.hash(plain, ROUNDS);
}

async function verify(plain, hash) {
  if (typeof plain !== 'string' || typeof hash !== 'string') return false;
  return bcrypt.compare(plain, hash);
}

module.exports = { hash, verify };
