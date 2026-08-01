import { describe, expect, it } from 'vitest';
import { createDecipheriv, createECDH, createPublicKey, createVerify } from 'node:crypto';
import { _internals, b64urlDecode, b64urlEncode, encryptPayload, generateVapidKeys, vapidAuthorization } from '../src/push/webpush.js';

/**
 * RFC 8291 §5 — the specification's own worked example. Known keys, known
 * salt, known ciphertext. This is the test that makes hand-rolling the crypto
 * defensible instead of hopeful: a round-trip test would happily pass with a
 * consistently wrong key schedule, and the failure mode of a wrong key
 * schedule is a notification that silently never arrives.
 */
const RFC8291 = {
  plaintext: 'When I grow up, I want to be a watermelon',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

describe('web push encryption (RFC 8291)', () => {
  it("reproduces the RFC's worked example byte-for-byte", () => {
    const { body } = encryptPayload(
      RFC8291.plaintext,
      { p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret },
      { salt: b64urlDecode(RFC8291.salt), senderPrivateKey: b64urlDecode(RFC8291.asPrivate) },
    );
    expect(b64urlEncode(body)).toBe(RFC8291.body);
  });

  it('lays the header out per RFC 8188: salt, record size, key id length, key id', () => {
    const { body } = encryptPayload(
      RFC8291.plaintext,
      { p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret },
      { salt: b64urlDecode(RFC8291.salt), senderPrivateKey: b64urlDecode(RFC8291.asPrivate) },
    );
    expect(b64urlEncode(body.subarray(0, 16))).toBe(RFC8291.salt);
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(body.readUInt8(20)).toBe(65);
    expect(b64urlEncode(body.subarray(21, 86))).toBe(RFC8291.asPublic);
  });

  it('uses a fresh salt and ephemeral key per message — a reused pair would be a real break, not a style issue', () => {
    const keys = { p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret };
    const a = encryptPayload('same text', keys).body;
    const b = encryptPayload('same text', keys).body;
    expect(a.subarray(0, 16).equals(b.subarray(0, 16))).toBe(false); // salt
    expect(a.subarray(21, 86).equals(b.subarray(21, 86))).toBe(false); // ephemeral public key
  });

  it('round-trips a real payload through an independently derived decryption', () => {
    // Decrypt with the UA's own private key, deriving the keys from the wire
    // format rather than from anything encryptPayload returned.
    const payload = JSON.stringify({ title: 'Snack', body: '3:30 — protein.' });
    const { body } = encryptPayload(payload, { p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret });

    const salt = body.subarray(0, 16);
    const asPublic = body.subarray(21, 86);
    const ciphertext = body.subarray(86);

    const ua = createECDH('prime256v1');
    ua.setPrivateKey(b64urlDecode(RFC8291.uaPrivate));
    const shared = ua.computeSecret(asPublic);

    const { hkdf, info } = _internals;
    const ikm = hkdf(b64urlDecode(RFC8291.authSecret), shared, info('WebPush: info', b64urlDecode(RFC8291.uaPublic), asPublic), 32);
    const cek = hkdf(salt, ikm, info('Content-Encoding: aes128gcm'), 16);
    const nonce = hkdf(salt, ikm, info('Content-Encoding: nonce'), 12);

    const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
    expect(plain.subarray(-1)[0]).toBe(0x02); // last-record delimiter
    expect(plain.subarray(0, -1).toString('utf8')).toBe(payload);
  });

  it('rejects malformed subscription keys rather than sending garbage', () => {
    expect(() => encryptPayload('x', { p256dh: b64urlEncode(Buffer.alloc(10)), auth: RFC8291.authSecret })).toThrow(/65-byte/);
    expect(() => encryptPayload('x', { p256dh: RFC8291.uaPublic, auth: b64urlEncode(Buffer.alloc(8)) })).toThrow(/16 bytes/);
  });
});

describe('VAPID (RFC 8292)', () => {
  it('produces a verifiable ES256 JWT scoped to the push service origin', () => {
    const keys = generateVapidKeys();
    const header = vapidAuthorization({
      endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/abc123',
      subject: 'mailto:below413@gmail.com',
      keys,
      now: () => 1_780_000_000_000,
    });

    const m = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(header);
    expect(m).not.toBeNull();
    const [, jwt, k] = m as RegExpExecArray;
    expect(k).toBe(keys.publicKey);

    const [h, c, sig] = jwt.split('.');
    expect(JSON.parse(b64urlDecode(h).toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(b64urlDecode(c).toString());
    // Audience is the ORIGIN, not the endpoint — push services reject the latter.
    expect(claims.aud).toBe('https://updates.push.services.mozilla.com');
    expect(claims.sub).toBe('mailto:below413@gmail.com');
    expect(claims.exp).toBe(1_780_000_000 + 12 * 3600);

    const raw = b64urlDecode(keys.publicKey);
    const pub = createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: b64urlEncode(raw.subarray(1, 33)), y: b64urlEncode(raw.subarray(33, 65)) },
      format: 'jwk',
    });
    const v = createVerify('sha256');
    v.update(`${h}.${c}`);
    expect(v.verify({ key: pub, dsaEncoding: 'ieee-p1363' }, b64urlDecode(sig))).toBe(true);
  });

  it('generates a 65-byte uncompressed public key and a 32-byte private scalar', () => {
    const keys = generateVapidKeys();
    expect(b64urlDecode(keys.publicKey)).toHaveLength(65);
    expect(b64urlDecode(keys.publicKey)[0]).toBe(0x04);
    expect(b64urlDecode(keys.privateKey)).toHaveLength(32);
  });
});
