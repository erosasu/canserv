// errors.js
export class ApiError extends Error {
  constructor(message, statusCode = null) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}
