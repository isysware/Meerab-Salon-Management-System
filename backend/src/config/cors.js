export const isAllowedOrigin = (origin, configuredOrigins, isDevelopment) => {
  if (!origin) return true; // Non-browser clients do not send an Origin header.
  let parsed;
  try { parsed = new URL(origin); } catch { return false; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  
  // Allow all if wildcard configured or in development mode
  if (configuredOrigins.includes('*')) return true;
  if (isDevelopment) return true;
  
  if (configuredOrigins.includes(origin)) return true;
  if (parsed.hostname.endsWith('.vercel.app')) return true;
  if (parsed.hostname.endsWith('.trycloudflare.com') || parsed.hostname.endsWith('.ngrok-free.app') || parsed.hostname.endsWith('.ngrok.io')) return true;
  
  return ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
};
