const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const MIN_LENGTH = 6;
const MAX_LENGTH = 8;

function randomLength() {
  const buffer = new Uint8Array(1);
  crypto.getRandomValues(buffer);
  return MIN_LENGTH + (buffer[0] % (MAX_LENGTH - MIN_LENGTH + 1));
}

export function generateJoinCode(length?: number) {
  const targetLength = length
    ? Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, Math.floor(length)))
    : randomLength();

  const buffer = new Uint8Array(targetLength);
  crypto.getRandomValues(buffer);

  let code = "";
  buffer.forEach((value) => {
    code += ALPHABET[value % ALPHABET.length];
  });

  return code;
}

export function normalizeJoinCode(value: string | undefined | null) {
  return (value ?? "").trim().toLowerCase();
}

export function isValidJoinCode(code: string) {
  return /^[a-z0-9]{6,8}$/.test(code);
}
