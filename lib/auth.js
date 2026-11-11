'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const { get, run } = require('./db');
const { uid, sha256, nowISO, HttpError } = require('./util');

const COOKIE = 'tp_session';
const SESSION_DAYS = 30;

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(keyHex, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}
function checkPasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'Password must be at least 8 characters', { Password: 'Min 8 characters' });
  if (pw.length > 200) throw new HttpError(400, 'Password is too long');
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(userId, req) {
  const token = uid(32);
  const exp = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  run('INSERT INTO sessions(token_hash,user_id,created_at,expires_at,ip,ua) VALUES(?,?,?,?,?,?)',
    sha256(token), userId, nowISO(), exp, req.ip || null, String(req.headers['user-agent'] || '').slice(0, 200));
  run('UPDATE users SET last_login=? WHERE id=?', nowISO(), userId);
  return token;
}
function cookieHeader(token, req, clear = false) {
  const secure = req.secure ? '; Secure' : '';
  if (clear) return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}
function destroySession(req) {
  const t = parseCookies(req)[COOKIE];
  if (t) run('DELETE FROM sessions WHERE token_hash=?', sha256(t));
}
function destroyUserSessions(userId) { run('DELETE FROM sessions WHERE user_id=?', userId); }

function currentUser(req) {
  const t = parseCookies(req)[COOKIE];
  if (!t) return null;
  const row = get(`SELECT u.id,u.role,u.name,u.email,u.phone,u.active,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`, sha256(t));
  if (!row || !row.active) return null;
  if (row.expires_at < nowISO()) { run('DELETE FROM sessions WHERE token_hash=?', sha256(t)); return null; }
  return { id: row.id, role: row.role, name: row.name, email: row.email, phone: row.phone };
}

function need(user, ...roles) {
  if (!user) throw new HttpError(401, 'Please log in to continue');
  if (roles.length && !roles.includes(user.role)) throw new HttpError(403, 'You do not have permission to do that');
  return user;
}

module.exports = { hashPassword, verifyPassword, checkPasswordStrength, createSession, cookieHeader, destroySession, destroyUserSessions, currentUser, need, parseCookies };
