export class PermanentTaskError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PermanentTaskError';
  }
}
