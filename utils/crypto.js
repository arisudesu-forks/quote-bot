const crypto = require('crypto');

function generateKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 16 * 2, 'sha512').toString('hex');
}

function encryptData(key, data) {
  const db = Buffer.from(data);
  const kb = Buffer.from(key, 'hex');

  const ivBytes = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', kb, ivBytes);
  return Buffer.concat([ivBytes, cipher.update(db), cipher.final()]).toString('hex');
}

function decryptData(key, data) {
  const db = Buffer.from(data, 'hex');
  const kb = Buffer.from(key, 'hex');

  const ivBytes = db.slice(0, 16);
  const rawData = db.slice(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', kb, ivBytes);
  return Buffer.concat([decipher.update(rawData), decipher.final()]).toString();
}

module.exports = {
  encryptData,
  decryptData
}
