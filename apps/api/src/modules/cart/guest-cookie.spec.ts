import { newGuestToken, signGuestToken, verifyGuestCookie } from './guest-cookie';

const secret = 'test-secret-0123456789abcdef';

describe('guest_cart cookie', () => {
  it('round-trips a signed token', () => {
    const token = newGuestToken();
    expect(verifyGuestCookie(signGuestToken(token, secret), secret)).toBe(token);
  });

  it('rejects tampering, other secrets and junk', () => {
    const token = newGuestToken();
    const cookie = signGuestToken(token, secret);
    const other = newGuestToken();
    expect(verifyGuestCookie(`${other}.${cookie.split('.')[1]}`, secret)).toBeNull();
    expect(verifyGuestCookie(cookie, 'another-secret-0123456789')).toBeNull();
    expect(verifyGuestCookie('nope', secret)).toBeNull();
    expect(verifyGuestCookie(undefined, secret)).toBeNull();
  });
});
