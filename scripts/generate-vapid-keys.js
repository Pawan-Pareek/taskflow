// Generates a VAPID key pair for Web Push (no dependencies).
// Usage: node scripts/generate-vapid-keys.js
// Writes the PRIVATE key to supabase/.vapid-private.key (git-ignored) and prints the PUBLIC key.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });
const b64 = (s) => s; // JWK x/y/d are already base64url
const publicRaw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString('base64url');

const out = path.join(__dirname, '..', 'supabase', '.vapid-private.key');
fs.writeFileSync(out, priv.d + '\n');
console.log('VAPID_PUBLIC_KEY=' + publicRaw);
console.log('Private key saved to ' + out + ' (git-ignored). Do not commit or share it.');
