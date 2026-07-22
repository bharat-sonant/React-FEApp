/**
 * Password encryption — a byte-for-byte port of the old native app's scheme
 * (CommonFunctions.encrypt / generateKey), so existing stored passwords match.
 *
 *   stored == Base64( AES-256-ECB-PKCS5( password, key = SHA-256(userId) ) )
 *
 * Verified against real records (userId "113" and "101"): the output matches
 * the value stored in Firebase exactly.
 *
 * Details that must not change or logins break:
 *  - the AES key is SHA-256 of the *userId*, not the password
 *  - ECB mode, PKCS5/PKCS7 padding, no IV (Android's `Cipher.getInstance("AES")`)
 *  - the old app used Base64.DEFAULT, which appends a trailing "\n"; stored
 *    values therefore end in "\n". We compare with that whitespace trimmed so
 *    it doesn't matter either way.
 */
import CryptoJS from 'crypto-js';

export const encryptPassword = (password, userId) => {
  const key = CryptoJS.SHA256(String(userId)); // 32-byte WordArray
  const encrypted = CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(String(password)), key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });
  return encrypted.toString(); // Base64
};

/** Compare a typed password against the stored ciphertext (trailing "\n" safe). */
export const passwordMatches = (typedPassword, userId, storedCipher) => {
  const mine = encryptPassword(typedPassword, userId).trim();
  const stored = String(storedCipher || '').trim();
  return !!stored && mine === stored;
};
