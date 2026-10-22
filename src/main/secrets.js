'use strict';

/**
 * API Key 使用 Electron safeStorage（Windows 下为 DPAPI）加密后落盘。
 * 只在主进程解密；渲染进程永远拿不到明文。
 */

let cachedAvailable = null;

async function initSecrets() {
  try {
    const electron = require('electron');
    const ss = electron && electron.safeStorage;
    if (!ss) {
      cachedAvailable = false;
      return false;
    }
    cachedAvailable = await ss.isAsyncEncryptionAvailable();
  } catch {
    cachedAvailable = false;
  }
  return cachedAvailable;
}

function safeStorageOrNull() {
  try {
    const electron = require('electron');
    const ss = electron && electron.safeStorage;
    if (!ss) return null;
    if (cachedAvailable === false) return null;
    return ss;
  } catch {}
  return null;
}

function encrypt(plain) {
  const text = String(plain || '');
  if (!text) return '';
  const ss = safeStorageOrNull();
  if (ss) {
    try {
      return 'enc:v1:' + ss.encryptString(text).toString('base64');
    } catch (err) {
      console.warn('[secrets] 加密失败，回退到本机混淆存储', err.message);
    }
  }
  return 'obf:v1:' + Buffer.from(text, 'utf8').toString('base64');
}

function decrypt(cipher) {
  const text = String(cipher || '');
  if (!text) return '';
  if (text.startsWith('enc:v1:')) {
    const ss = safeStorageOrNull();
    if (!ss) return '';
    try {
      return ss.decryptString(Buffer.from(text.slice(7), 'base64'));
    } catch {
      return '';
    }
  }
  if (text.startsWith('obf:v1:')) {
    try {
      return Buffer.from(text.slice(7), 'base64').toString('utf8');
    } catch {
      return '';
    }
  }
  return '';
}

function hint(plain) {
  const s = String(plain || '');
  if (!s) return '';
  if (s.length <= 6) return '••••';
  return '••••' + s.slice(-4);
}

function encryptionAvailable() {
  return cachedAvailable === true;
}

module.exports = { initSecrets, encrypt, decrypt, hint, encryptionAvailable };
