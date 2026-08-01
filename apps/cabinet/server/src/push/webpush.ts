import { createCipheriv, createECDH, createPrivateKey, createPublicKey, generateKeyPairSync, hkdfSync, randomBytes, sign } from 'node:crypto';

/**
 * Web Push, from the RFCs, on node:crypto alone (2026-08-01).
 *
 * Two specs, both small and both frozen:
 *   RFC 8291 — Message Encryption for Web Push (the ECDH + HKDF key schedule)
 *   RFC 8188 — Encrypted Content-Encoding (the aes128gcm record framing)
 *   RFC 8292 — VAPID (an ES256 JWT identifying this server to the push service)
 *
 * Hand-rolled rather than pulled in, on Ben's standing preference: node's
 * webcrypto already has every primitive (ECDH on P-256, HKDF-SHA256,
 * AES-128-GCM, ECDSA), so the dependency would be packaging, not capability.
 * The thing that makes that defensible is `webpush.test.ts`, which runs the
 * complete worked example from RFC 8291 §5 — known keys, known salt, known
 * ciphertext — so this is verified against the specification itself rather
 * than against a round trip with its own bugs.
 *
 * Why it matters here: RHYTHM.md is built on pings (morning brief, 3:30pm
 * snack, evening block, wind-down). Before this, those fired into an in-app
 * SSE bus, which reaches Ben only if a browser tab happens to be open. A plan
 * whose structure can't reach the person is not structure.
 */

const P256 = 'prime256v1';

export interface PushSubscriptionKeys {
  /** The client's P-256 public key, base64url, 65 raw bytes uncompressed. */
  p256dh: string;
  /** The client's 16-byte authentication secret, base64url. */
  auth: string;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

export function b64urlEncode(b: Buffer): string {
  return b.toString('base64url');
}

/**
 * Generate a VAPID keypair. Run once; the pair identifies this server to every
 * push service forever, and rotating it silently invalidates every existing
 * subscription — so it lives in .env, not in code, and not in the database.
 */
export function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: P256 });
  const jwk = privateKey.export({ format: 'jwk' }) as { x: string; y: string; d: string };
  return {
    publicKey: b64urlEncode(Buffer.concat([Buffer.from([0x04]), b64urlDecode(jwk.x), b64urlDecode(jwk.y)])),
    privateKey: jwk.d,
  };
}

/** Raw 65-byte uncompressed P-256 point → a node KeyObject. */
function publicKeyFromRaw(raw: Buffer) {
  if (raw.length !== 65 || raw[0] !== 0x04) throw new Error('expected a 65-byte uncompressed P-256 point');
  return createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: b64urlEncode(raw.subarray(1, 33)), y: b64urlEncode(raw.subarray(33, 65)) },
    format: 'jwk',
  });
}

/** Raw 32-byte scalar + its public point → a node KeyObject for signing. */
function privateKeyFromRaw(d: Buffer, publicRaw: Buffer) {
  return createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: b64urlEncode(d),
      x: b64urlEncode(publicRaw.subarray(1, 33)),
      y: b64urlEncode(publicRaw.subarray(33, 65)),
    },
    format: 'jwk',
  });
}

/** `"<label>" || 0x00` — every HKDF info string in these RFCs has this shape. */
function info(label: string, ...rest: Buffer[]): Buffer {
  return Buffer.concat([Buffer.from(label, 'ascii'), Buffer.from([0]), ...rest]);
}

function hkdf(salt: Buffer, ikm: Buffer, infoBuf: Buffer, length: number): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, infoBuf, length));
}

export interface EncryptResult {
  /** The complete aes128gcm body: header || ciphertext. */
  body: Buffer;
}

/**
 * Encrypt a payload for one subscription (RFC 8291 + RFC 8188).
 *
 * `salt` and `senderPrivateKey` are injectable ONLY so the RFC's worked
 * example can be reproduced byte-for-byte in the test. Production always takes
 * the random defaults — a reused salt or ephemeral key across messages would
 * be a real cryptographic failure, not a style question.
 */
export function encryptPayload(
  payload: string | Buffer,
  keys: PushSubscriptionKeys,
  testVectors?: { salt: Buffer; senderPrivateKey: Buffer },
): EncryptResult {
  const uaPublic = b64urlDecode(keys.p256dh);
  const authSecret = b64urlDecode(keys.auth);
  if (uaPublic.length !== 65) throw new Error('p256dh must be a 65-byte uncompressed P-256 point');
  if (authSecret.length !== 16) throw new Error('auth must be 16 bytes');

  const salt = testVectors?.salt ?? randomBytes(16);
  const ecdh = createECDH(P256);
  if (testVectors) ecdh.setPrivateKey(testVectors.senderPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(uaPublic);

  // RFC 8291 §3.3: the auth secret is the HKDF *salt* here, and the resulting
  // 32-byte IKM is what feeds the RFC 8188 schedule below.
  const ikm = hkdf(authSecret, sharedSecret, info('WebPush: info', uaPublic, asPublic), 32);
  const cek = hkdf(salt, ikm, info('Content-Encoding: aes128gcm'), 16);
  const nonce = hkdf(salt, ikm, info('Content-Encoding: nonce'), 12);

  // RFC 8188 §2: a record is plaintext followed by a delimiter octet; 0x02
  // marks the last record. Cabinet always sends exactly one.
  const plaintext = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const record = Buffer.concat([plaintext, Buffer.from([0x02])]);

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);

  // Header: salt(16) || record_size(4, big-endian) || key_id_len(1) || key_id.
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);

  return { body: Buffer.concat([header, asPublic, ciphertext]) };
}

/**
 * VAPID Authorization header (RFC 8292). The JWT's audience is the push
 * service's ORIGIN — not the full endpoint — and `sub` must be a contact the
 * push service can reach if Cabinet ever starts misbehaving.
 */
export function vapidAuthorization(opts: {
  endpoint: string;
  subject: string;
  keys: VapidKeys;
  /** Seconds; the spec caps this at 24h and push services enforce it. */
  ttlSeconds?: number;
  now?: () => number;
}): string {
  const now = opts.now ?? (() => Date.now());
  const aud = new URL(opts.endpoint).origin;
  const header = b64urlEncode(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(
    Buffer.from(
      JSON.stringify({
        aud,
        exp: Math.floor(now() / 1000) + (opts.ttlSeconds ?? 12 * 3600),
        sub: opts.subject,
      }),
    ),
  );
  const signingInput = Buffer.from(`${header}.${claims}`, 'ascii');
  const publicRaw = b64urlDecode(opts.keys.publicKey);
  const key = privateKeyFromRaw(b64urlDecode(opts.keys.privateKey), publicRaw);
  // JOSE wants the raw r||s pair, not the DER sequence node signs by default.
  const signature = sign('sha256', signingInput, { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${opts.keys.publicKey}`;
}

/** Exported for the RFC test vector, which needs to check the derived keys too. */
export const _internals = { hkdf, info, publicKeyFromRaw, privateKeyFromRaw };
