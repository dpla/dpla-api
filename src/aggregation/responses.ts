export class BadResponse {
  constructor(message: string, errorCode: number) {
    this.message = message;
    this.errorCode = errorCode;
  }

  message: string;
  errorCode: number;
}

export class UnrecognizedParameters extends BadResponse {
  constructor(message: string) {
    super("Unrecognized parameters: " + message, 400);
  }
}

export class InvalidParameter extends BadResponse {
  constructor(message: string) {
    super("Invalid parameter: " + message, 400);
  }
}

export class TooManyIdentifiers extends BadResponse {
  constructor(message: string) {
    super(message, 400);
  }
}

export class InternalError extends BadResponse {
  constructor() {
    super("Internal error", 500);
  }
}
