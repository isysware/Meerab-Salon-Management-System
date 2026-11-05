export function formatCurrency(
  amount: number | string | undefined | null,
  currency = 'PKR',
  maxFractionDigits?: number
): string {
  if (amount === undefined || amount === null || amount === '') {
    return `${currency} 0.00`;
  }
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) {
    return `${currency} 0.00`;
  }

  // Preserve up to 4 decimal places if amount contains sub-cents (e.g. 1000.3333)
  const hasSubCents =
    maxFractionDigits !== undefined
      ? maxFractionDigits > 2
      : Math.abs(num * 100 - Math.round(num * 100)) > 0.0001;

  const maxDigits =
    maxFractionDigits !== undefined
      ? maxFractionDigits
      : hasSubCents
      ? 4
      : 2;

  // Format as PKR with en-PK locale
  const formatted = new Intl.NumberFormat('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxDigits,
  }).format(num);

  return `${currency} ${formatted}`;
}

export function formatNumber(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) {
    return '0';
  }
  return new Intl.NumberFormat('en-PK').format(value);
}

export function formatPercent(rate: number | undefined | null): string {
  if (rate === undefined || rate === null || isNaN(rate)) {
    return '0%';
  }
  return `${(rate * 100).toFixed(0)}%`;
}

export function formatDate(dateString: string, timeZone = 'Asia/Karachi'): string {
  if (!dateString) return '';
  try {
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    return new Intl.DateTimeFormat('en-PK', {
      timeZone,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  } catch {
    return dateString;
  }
}

export function getTodayInBranchTimezone(timeZone = 'Asia/Karachi'): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(now); // outputs 'YYYY-MM-DD'
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

/**
 * Normalizes phone number into standard Pakistani digit string: '03001234567' / '(0376376478)'
 */
export function normalizePhoneDigits(phone: string): string {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0092')) {
    digits = digits.slice(4);
  } else if (digits.startsWith('92') && digits.length >= 11) {
    digits = digits.slice(2);
  }
  
  if (digits.length === 10 && digits.startsWith('3')) {
    digits = '0' + digits;
  } else if (!digits.startsWith('0') && digits.length >= 9 && digits.length <= 11) {
    digits = '0' + digits;
  }
  return digits;
}

/**
 * Standard phone display format: '+92 (300) 123-4567'
 */
export function formatPhoneNumber(phone: string): string {
  const digits = normalizePhoneDigits(phone);
  if (digits.length === 11 && digits.startsWith('03')) {
    const network = digits.slice(1, 4); // '300'
    const part1 = digits.slice(4, 7);   // '123'
    const part2 = digits.slice(7);      // '4567'
    return `+92 (${network}) ${part1}-${part2}`;
  }
  if (digits.length === 10 && digits.startsWith('03')) {
    const network = digits.slice(1, 4);
    const part1 = digits.slice(4, 7);
    const part2 = digits.slice(7);
    return `+92 (${network}) ${part1}-${part2}`;
  }
  return phone;
}

/**
 * Validates whether string is a valid phone number (at least 10 digits)
 */
export function isValidPhoneNumber(phone: string): boolean {
  const digits = normalizePhoneDigits(phone);
  return digits.length >= 10 && digits.length <= 15;
}
