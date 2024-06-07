import {
  allDataFields,
  coordinatesField,
  DataFieldType,
  facetableDataFields,
  getDataFieldType,
  searchableDataFields,
  sortableDataFields,
} from "./dpla_map_fields";
import {
  InvalidParameter,
  TooManyIdentifiers,
  UnrecognizedParameters,
} from "./responses";

export interface SearchParams {
  exactFieldMatch: boolean;
  facets?: string[];
  facetSize: number;
  fields?: string[];
  fieldQueries: FieldQuery[];
  filter?: Filter[];
  op: string;
  page: number;
  pageSize: number;
  q?: string;
  sortBy?: string;
  sortByPin?: string;
  sortOrder: string;
}

export interface FetchParams {
  fields?: string[];
}

export interface RandomParams {
  filter?: Filter;
}

export interface FieldQuery {
  fieldName: string;
  value: string;
}

export interface Filter {
  fieldName: string;
  value: string;
}

const defaultExactFieldMatch = false;
const defaultFacetSize = 50;
const minFacetSize = 0;
const maxFacetSize = 2000;
const defaultOp = "AND";
const defaultPage = 1;
const minPage = 1;
const maxPage = 100;
const defaultPageSize = 10;
const minPageSize = 0;
const maxPageSize = 2;
const defaultSortOrder = "asc";

export const acceptedSearchParams: string[] = [
  ...searchableDataFields,
  "exact_field_match",
  "facets",
  "facet_size",
  "fields",
  "filter",
  "op",
  "page",
  "page_size",
  "q",
  "sort_by",
  "sort_by_pin",
  "sort_order",
];

export const ignoredFields: string[] = ["sourceResource.subtitle"];

export function getFetchIds(
  id: string,
  rawParams: Map<string, string>,
): string[] | UnrecognizedParameters | TooManyIdentifiers | InvalidParameter {
  // There are no recognized params for a fetch request
  if (rawParams.size > 0) {
    let paramString = "";
    for (const [key, value] of rawParams) {
      paramString += `${key}, `;
    }

    return new UnrecognizedParameters(paramString);
  }
  const ids = id.split(",");
  if (ids.length > maxPageSize)
    return new TooManyIdentifiers(
      `The number of ids cannot exceed ${maxPageSize}`,
    );
  try {
    return ids.map((id) => getValidId(id));
  } catch (e: any) {
    return new InvalidParameter(e.message);
  }
}

export function getSearchParams(
  rawParams: Map<string, string>,
): SearchParams | UnrecognizedParameters | InvalidParameter {
  // Check for unrecognized params

  const unrecognized = Array.from(rawParams.keys()).filter(
    (key) => !acceptedSearchParams.includes(key),
  );

  if (unrecognized.length > 0) {
    return new UnrecognizedParameters(unrecognized.join(", "));
  } else {
    // Check for valid search params
    // Collect all the user-submitted field queries.
    const fieldQueries: FieldQuery[] = searchableDataFields
      .map((key) => getValidFieldQuery(rawParams, key))
      .filter((x) => x !== undefined) as FieldQuery[];

    console.log("field queries", fieldQueries);

    // Return valid search params. Provide defaults when appropriate.

    try {
      return {
        exactFieldMatch:
          getValid(
            rawParams,
            "exact_field_match",
            (param: string, paramName: string) =>
              validBoolean(param, paramName),
          ) || defaultExactFieldMatch,
        facets: getValid(rawParams, "facets", validFields),
        facetSize:
          getValid(rawParams, "facet_size", validIntWithRange) ||
          defaultFacetSize,
        fields: getValid(rawParams, "fields", validFields),
        fieldQueries: fieldQueries,
        filter: getValidFilter(rawParams),
        op: getValid(rawParams, "op", validAndOr) || defaultOp,
        page: getValid(rawParams, "page", validIntWithRange) || defaultPage,
        pageSize:
          getValid(rawParams, "page_size", validIntWithRange) ||
          defaultPageSize,
        q: getValid(rawParams, "q", validText),
        sortBy: getValidSortField(rawParams),
        sortByPin: getValidSortByPin(rawParams),
        sortOrder:
          getValid(rawParams, "sort_order", validSortOrder) || defaultSortOrder,
      };
    } catch (e: any) {
      return new InvalidParameter(e.message);
    }
  }
}

function getRandomParams(
  rawParams: Map<string, string>,
): RandomParams | UnrecognizedParameters | InvalidParameter {
  // Check for unrecognized params
  const unrecognized = Array.from(rawParams.keys()).filter(
    (param) => param === "filter",
  );

  if (unrecognized.length > 0) {
    return new UnrecognizedParameters(unrecognized.join(", "));
  } else {
    // Check for valid filter
    try {
      const filter = getValidFilter(rawParams);
      return { filter } as RandomParams;
    } catch (e: any) {
      return new InvalidParameter(e.message);
    }
  }
}

function getValidationMethod(
  paramName: string,
): (text: string, param: string) => string {
  const fieldType = getDataFieldType(paramName);
  if (fieldType === undefined)
    throw Error("Unrecognized parameter: " + paramName);
  switch (+fieldType) {
    case DataFieldType.TextField:
      return (text, param) => validText(text, param);
    case DataFieldType.URLField:
      return (text, param) => validUrl(text, param);
    case DataFieldType.DateField:
      return (text, param) => validDate(text, param);
    case DataFieldType.WildcardField:
      return (text, param) => validText(text, param);
    default:
      return (text, param) => validText(text, param);
  }
}

const idRegEx = /^[a-zA-Z0-9]{32}$/;

export function getValidId(id: string): string {
  const rule =
    "ID must be a String comprised of letters and numbers, and 32 characters long";
  if (idRegEx.test(id)) return id;
  else throw new Error(rule);
}

export function getValidFieldQuery(
  rawParams: Map<string, string>,
  paramName: string,
): FieldQuery | undefined {
  console.log("IN getValidFieldQuery", paramName, rawParams.get(paramName));
  const validationMethod = getValidationMethod(paramName);
  if (!rawParams.get(paramName)) {
    return undefined;
  }
  if (getValid(rawParams, paramName, validationMethod)) {
    return {
      fieldName: paramName,
      value: rawParams.get(paramName) as string,
    };
  } else return undefined;
}

function getValidFilter(rawParams: Map<string, string>): Filter[] | undefined {
  const filter = rawParams.get("filter");
  if (!filter) return undefined;

  const filterSplit = filter.split(":", 2);
  if (filterSplit.length < 2) throw Error(`${filter} is not a valid filter`);

  const fieldName = filterSplit[0] as string;
  const values = filterSplit[1].split("AND").map((x) => x.trim());

  if (searchableDataFields.includes(fieldName)) {
    const validationMethod = getValidationMethod(fieldName);

    return values
      .map((value) => {
        const params = new Map([[fieldName, value]]);
        const result = getValid(params, fieldName, validationMethod);
        if (result) {
          return { fieldName, value: result as string } as Filter;
        }
      })
      .filter((x) => x !== undefined) as Filter[];
  } else {
    throw Error(`${fieldName} is not a valid filter field`);
  }
}

/**
 * Get a valid value for sort_by parameter.
 * Must be in the list of sortable fields.
 * If coordinates, query must also contain the "sort_by_pin" parameter.
 */
function getValidSortField(rawParams: Map<string, string>): string | undefined {
  const sortFieldOrUndefined = rawParams.get("sort_by");
  if (!sortFieldOrUndefined) return undefined;
  const sortField = sortFieldOrUndefined as string;
  // Check if field is sortable according to the field definition
  if (!sortableDataFields.includes(sortField)) {
    throw Error(`'${sortField}' is not an allowable value for sort_by`);
  }
  // Check if field represents coordinates
  if (coordinatesField.name === sortField) {
    // Check if raw params also contains sort_by_pin
    const sortByPin = rawParams.get("sort_by_pin");
    if (sortByPin) {
      return sortField;
    } else {
      throw Error("The sort_by_pin parameter is required.");
    }
  } else {
    return sortField;
  }
}

function getValidSortByPin(rawParams: Map<string, string>): string | undefined {
  const sortByPinOrUndefined = rawParams.get("sort_by_pin");
  if (!sortByPinOrUndefined) return undefined;
  // Check if field is valid text (will throw exception if not)
  const validCoordinates = validText(sortByPinOrUndefined, "sort_by_pin");
  // Check if raw params also contains "sort_by" with coordinates field
  const sortByOrUndefined = rawParams.get("sort_by");
  if (!sortByOrUndefined) {
    throw Error("The sort_by parameter is required.");
  }
  if (coordinatesField.name === (sortByOrUndefined as string)) {
    return validCoordinates;
  } else {
    throw Error("The sort_by parameter is required.");
  }
}

export function getValid<T>(
  rawParams: Map<string, string>,
  paramName: string,
  validationMethod: (param: string, paramName: string) => T,
): T | undefined {
  const param = rawParams.get(paramName);
  if (!param) return undefined;
  return validationMethod(param, paramName);
}

function validBoolean(boolString: string, param: string): boolean {
  if ("true" === boolString) {
    return true;
  } else if ("false" === boolString) {
    return false;
  } else {
    throw new Error(`${param} must be 'true' or 'false'`);
  }
}

function validFields(fieldString: string, param: string): string[] {
  let acceptedFields: string[] = [];

  if (param === "facets") {
    acceptedFields = facetableDataFields;
  } else if (param === "fields") {
    acceptedFields = allDataFields;
  }

  return fieldString
    .split(",")
    .flatMap((candidate) => {
      // Need to check ignoredFields first b/c acceptedFields may contain
      // fields that are also in ignoredFields
      if (ignoredFields.includes(candidate)) {
        return undefined;
      } else if (acceptedFields.includes(candidate)) {
        return candidate;
      } else if (
        param === "facets" &&
        coordinatesField.name === candidate.split(":")[0] //todo this might be explody
      ) {
        return candidate;
      } else {
        throw Error(`'${candidate}' is not an allowable value for '${param}'`);
      }
    })
    .filter((x) => x !== undefined) as string[];
}

function validIntWithRange(intString: string, param: string): number {
  let min = 0;
  let max = 2147483647;

  switch (param) {
    case "facet_size":
      min = minFacetSize;
      max = maxFacetSize;
      break;
    case "page":
      min = minPage;
      max = maxPage;
      break;
    case "page_size":
      min = minPageSize;
      max = maxPageSize;
      break;
  }
  const rule = `${param} must be an integer between 0 and ${max}`;

  let parsed = null;

  try {
    parsed = parseInt(intString);
  } catch (_) {
    throw Error(rule);
  }

  if (parsed < min) throw Error(rule);
  if (parsed > max) throw Error(rule);
  return parsed;
}

// Must be a string between 2 and 200 characters.
function validText(text: string, param: string): string {
  if (text.length < 2 || text.length > 200) {
    // In the DPLA API (cultural heritage), an exception is thrown if q is too
    // long, but not if q is too short.
    // For internal consistency, and exception is thrown here in both cases.
    throw Error(`${param} must be between 2 and 200 characters`);
  }
  return text;
}

function validDate(text: string, param: string): string {
  const rule = `${param} must be in the form YYYY or YYYY-MM or YYYY-MM-DD`;
  const year = /\d{4}/;
  const yearMonth = /\d{4}-\d{2}/;
  const yearMonthDay = /\d{4}-\d{2}-\d{2}/;

  if (year.test(text) || yearMonth.test(text) || yearMonthDay.test(text)) {
    return text;
  } else {
    throw Error(rule);
  }
}

function validUrl(url: string, param: string): string {
  let clean: string = url;

  // Strip leading & trailing quotation marks for the purpose of checking for valid URL
  if (url.startsWith('"') && url.endsWith('"')) {
    clean = url.slice(1, -1);
  }

  try {
    new URL(clean);
    // return value with leading & trailing quotation marks intact
    return url;
  } catch (_) {
    throw new Error(`${param} must be a valid URL`);
  }
}

export function validAndOr(andor: string, param: string): string {
  if (andor === "AND" || andor === "OR") return andor;
  else throw Error(`${param} must be 'AND' or 'OR'`);
}

export function validSortOrder(order: string, param: string): string {
  if (order === "asc" || order === "desc") return order;
  else throw Error(`${param} must be 'asc' or 'desc'`);
}
