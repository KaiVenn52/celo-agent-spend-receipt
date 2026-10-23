import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export function sessionOwner(req, res, secret, secure = false) {
  const sign = (value) => createHmac('sha256', secret).update(value).digest('hex');
  const cookie = (req.headers.cookie || '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('asr_session='))
    ?.slice(12);
  if (cookie && /^[a-f0-9]{48}\.[a-f0-9]{64}$/.test(cookie)) {
    const [id, sig] = cookie.split('.');
    if (timingSafeEqual(Buffer.from(sig), Buffer.from(sign(id)))) return id;
  }
  const id = randomBytes(24).toString('hex');
  res.setHeader(
    'Set-Cookie',
    `asr_session=${id}.${sign(id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure ? '; Secure' : ''}`,
  );
  return id;
}
