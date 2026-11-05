// src/lib/phone.js
// Same phone rules as the frontend (src/lib/formatters.ts) so duplicates are detected identically.

/** '+92 (300) 123-4567' / '0092300…' / '0300-1234567' / '(0376376478)' → '03001234567' */
export const normalizePhoneDigits = (phone) => {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0092')) digits = digits.slice(4);
  else if (digits.startsWith('92') && digits.length >= 11) digits = digits.slice(2);
  
  if (digits.length === 10 && digits.startsWith('3')) {
    digits = '0' + digits;
  } else if (!digits.startsWith('0') && digits.length >= 9 && digits.length <= 11) {
    digits = '0' + digits;
  }
  return digits;
};

/** Display format '+92 (300) 123-4567' for Pakistani mobiles; other numbers are formatted nicely or returned unchanged. */
export const formatPhoneNumber = (phone) => {
  const digits = normalizePhoneDigits(phone);
  if (digits.length === 11 && digits.startsWith('03')) {
    return `+92 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10 && digits.startsWith('03')) {
    return `+92 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
};

export const isValidPhoneNumber = (phone) => {
  const digits = normalizePhoneDigits(phone);
  return digits.length >= 10 && digits.length <= 15;
};
