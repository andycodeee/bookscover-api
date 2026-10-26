'use strict';

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const bannedError = (reason) =>
  new ApiError(403, 'banned', reason || 'This account is restricted');

module.exports = { ApiError, bannedError };
