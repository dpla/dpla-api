/**
 * It's not you, it's us.
 */
export class FiveHundredResponse {
  constructor(message: string, errorCode: number) {
    this.message = message;
    this.errorCode = errorCode;
  }

  message: string;
  errorCode: number;
}

export class InternalErrorResponse extends FiveHundredResponse {
  constructor() {
    super("Internal error", 500);
  }
}

/**
 * It's not us, it's you.
 */
export class FourHundredResponse {
  constructor(message: string, errorCode: number) {
    this.message = message;
    this.errorCode = errorCode;
  }

  message: string;
  errorCode: number;
}

export class UnrecognizedParameters extends FourHundredResponse {
  constructor(message: string) {
    super("Unrecognized parameters: " + message, 400);
  }
}

export class InvalidParameter extends FourHundredResponse {
  constructor(message: string) {
    super("Invalid parameter: " + message, 400);
  }
}

export class TooManyIdentifiers extends FourHundredResponse {
  constructor(message: string) {
    super(message, 400);
  }
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
  bucketsLabel: String;
}

interface Bucket {
  key?: string;
  keyAsString?: string;
  docCount?: number;
  from?: number;
  to?: number;
}
