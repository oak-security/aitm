export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function insist(condition, message, status = 422, code = 'invalid_input') {
  if (!condition) throw new AppError(status, code, message);
}

export function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
      .join('; ');
    throw new AppError(422, 'invalid_input', detail);
  }
  return result.data;
}
