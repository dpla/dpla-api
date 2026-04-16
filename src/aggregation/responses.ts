class ErrorResponse {
  constructor(
    message: string,
    readonly errorCode: number,
    error: string,
  ) {
    this.message = message;
    this.error = error;
  }

  message: string;
  error: string;

  toJSON() {
    return { error: this.error, message: this.message };
  }
}

/**
 * It's not us, it's you.
 */
export class FourHundredResponse extends ErrorResponse {}

export class InvalidEmail extends FourHundredResponse {
  constructor() {
    super("Invalid email address.", 400, "invalid_email");
  }
}

export class UnrecognizedParameters extends FourHundredResponse {
  constructor(message: string) {
    super("Unrecognized parameters: " + message, 400, "unrecognized_parameters");
  }
}

export class InvalidParameter extends FourHundredResponse {
  constructor(message: string) {
    super("Invalid parameter: " + message, 400, "invalid_parameter");
  }
}

export class TooManyIdentifiers extends FourHundredResponse {
  constructor(message: string) {
    super(message, 400, "too_many_identifiers");
  }
}

export class UnauthorizedResponse extends FourHundredResponse {
  constructor() {
    super("Unauthorized", 401, "unauthorized");
  }
}

/**
 * It's not you, it's us.
 */
export class FiveHundredResponse extends ErrorResponse {}

export class InternalErrorResponse extends FiveHundredResponse {
  constructor() {
    super("Internal error", 500, "internal_error");
  }
}

export class EmailSent {
  constructor(email: string) {
    this.message = `API key information sent to ${email}`;
  }

  message: string;
}

export class DPLADocList {
  constructor(docs: any[]) {
    this.docs = docs;
  }

  count?: number;
  limit?: number;
  start?: number;
  docs: any[];
  facets?: FacetList;
}

interface FacetList {
  facets: Facet[];
}

interface Facet {
  field: string;
  type: string;
  buckets: Bucket[];
  bucketsLabel: string;
}

interface Bucket {
  key?: string;
  keyAsString?: string;
  docCount?: number;
  from?: number;
  to?: number;
}
