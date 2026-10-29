/**
 * The kind of device, where a page must act differently: iPhones and iPads hand every
 * otpauth:// link to Apple Passwords (no other app can be chosen), Android hands it to an
 * installed authenticator app, and a computer is used to scan a QR code with a phone.
 */
export type Platform = 'ios' | 'android' | 'computer';

export function detectPlatform(
  nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator,
): Platform {
  const agent = nav.userAgent;
  // iPadOS reports itself as a Mac; a Mac has no touch screen.
  if (/iPhone|iPad|iPod/i.test(agent) || (/Macintosh/i.test(agent) && nav.maxTouchPoints > 1)) {
    return 'ios';
  }
  if (/Android/i.test(agent)) return 'android';
  return 'computer';
}
