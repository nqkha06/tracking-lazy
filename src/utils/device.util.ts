export type DeviceKind = 'mobile' | 'desktop' | 'tablet';

export const DEVICE_CODE: Record<DeviceKind, number> = {
  mobile: 1,
  desktop: 2,
  tablet: 3,
};

export function detectDevice(userAgent: string): DeviceKind {
  const ua = (userAgent || '').toLowerCase();

  if (!ua) {
    return 'desktop';
  }

  if (/ipad|tablet|kindle|playbook|silk/.test(ua)) {
    return 'tablet';
  }

  if (/mobi|android|iphone|ipod|blackberry|iemobile|opera mini/.test(ua)) {
    return 'mobile';
  }

  return 'desktop';
}

export function detectBrowser(userAgent: string): string {
  const ua = userAgent || '';

  if (/edg\//i.test(ua)) return 'Edge';
  if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) return 'Chrome';
  if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) return 'Safari';
  if (/firefox\//i.test(ua)) return 'Firefox';
  if (/opr\//i.test(ua) || /opera\//i.test(ua)) return 'Opera';

  return 'Unknown';
}

export function detectOs(userAgent: string): string {
  const ua = userAgent || '';

  if (/windows nt/i.test(ua)) return 'Windows';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/mac os x/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';

  return 'Unknown';
}

export function sanitizeUserAgent(userAgent: string): string {
  return (userAgent || '').slice(0, 1024).trim();
}
