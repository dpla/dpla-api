import {
  FieldQuery,
  Filter,
  RandomParams,
  SearchParams,
} from "./param_validator";
import {
  coordinatesField,
  dateFields,
  getElasticSearchExactMatchField,
  getElasticSearchField,
  getElasticSearchNotAnalyzed,
} from "./dpla_map_fields";

export function composeMultiFetchQuery(ids: string[]): any {
  return {
    from: 0,
    size: ids.length,
    query: {
      terms: {
        id: ids,
      },
    },
    sort: {
      id: {
        order: "asc",
      },
    },
  };
}

export function composeRandomQuery(params: RandomParams): any {
  const filterClause: any | undefined = params.filter
    ? filterQuery([params.filter])
    : undefined;

  // Setting "boost_mode" to "sum" ensures that if a filter is used, the
  // random query will return a different doc every time (otherwise, it will
  // return the same doc over and over).
  let functionScore: any = {
    random_score: {},
    boost_mode: "sum",
  };

  if (filterClause !== undefined) {
    functionScore = {
      ...functionScore,
      bool: { filter: filterClause as any },
    };
  }

  return {
    query: {
      function_score: functionScore,
    },
    size: 1,
  };
}

export function composeSearchQuery(params: SearchParams): any {
  return {
    from: from(params.page, params.pageSize),
    size: params.pageSize,
    query: query(
      params.fieldQueries,
      params.exactFieldMatch,
      params.op,
      params.q,
      params.filter,
    ),
    aggs: aggs(params.facets, params.facetSize),
    sort: sort(params),
    _source: fieldRetrieval(params.fields),
    track_total_hits: true,
  };
}

const keywordQueryFields = [
  "dataProvider.name^1",
  "intermediateProvider^1",
  "provider.name^1",
  "sourceResource.collection.description^1",
  "sourceResource.collection.title^1",
  "sourceResource.contributor^1",
  "sourceResource.creator^1",
  "sourceResource.description^0.75",
  "sourceResource.extent^1",
  "sourceResource.format^1",
  "sourceResource.language.name^1",
  "sourceResource.publisher^1",
  "sourceResource.relation^1",
  "sourceResource.rights^1",
  "sourceResource.spatial.country^0.75",
  "sourceResource.spatial.county^1",
  "sourceResource.spatial.name^1",
  "sourceResource.spatial.region^1",
  "sourceResource.spatial.state^0.75",
  "sourceResource.specType^1",
  "sourceResource.subject.name^1",
  "sourceResource.subtitle^2",
  "sourceResource.title^2",
  "sourceResource.type^1",
];

function from(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

function query(
  fieldQueries: FieldQuery[],
  exactFieldMatch: boolean,
  op: string,
  q?: string,
  filter?: Filter[],
): any {
  const keyword: any[] = q ? keywordQuery(q, keywordQueryFields) : [];
  const filterClause: any | undefined =
    filter !== undefined ? filterQuery(filter) : undefined;
  const fieldQuery: any[] = fieldQueries
    .map((fieldQuery) => singleFieldQuery(fieldQuery, exactFieldMatch))
    .filter((x) => x !== undefined);
  const queryTerms: any[] = [...keyword, ...fieldQuery];

  const boolTerm: String = op === "OR" ? "should" : "must";

  if (queryTerms.length === 0 && filterClause === undefined) {
    return {
      match_all: {},
    };
  } else {
    let boolBase: any = {};
    if (queryTerms.length > 0) {
      boolBase.set(boolTerm, queryTerms);
    }
    if (filterClause !== undefined) {
      boolBase.set("filter", filterClause);
    }
    return {
      bool: boolBase,
    };
  }
}

/**
 * A general keyword query on the given fields.
 * "query_string" does a keyword search within the given fields.
 * It is case-insensitive and analyzes the search term.
 */
function keywordQuery(q: string, fields: string[]): any {
  return {
    query_string: {
      fields: fields,
      query: q,
      analyze_wildcard: true,
      default_operator: "AND",
      lenient: true,
    },
  };
}

/**
 * A filter for a specific field.
 * This will filter out fields that do not match the given value, but will
 * not affect the score for matching documents.
 */
function filterQuery(filters: Filter[]): any {
  const mustArray: any[] = filters.map((filter) => {
    const filterTermParam: any = {};
    filterTermParam.set(filter.fieldName, filter.value);
    return {
      term: filterTermParam,
    } as any;
  });

  return {
    bool: {
      must: mustArray,
    },
  };
}

function rangeQuery(fieldQuery: FieldQuery, isBefore: boolean) {
  // Range query
  const field: string | undefined = getElasticSearchField(fieldQuery.fieldName);
  if (field === undefined) {
    throw new Error("Unrecognized field name: " + fieldQuery.fieldName);
  }

  const sort = isBefore ? "lte" : "gte";

  const obj = {
    range: {
      [field]: {
        [sort]: fieldQuery.value,
      },
    },
  };
  return [obj];
}

function exactMatchQuery(fieldQuery: FieldQuery) {
  const field: String | undefined = getElasticSearchExactMatchField(
    fieldQuery.fieldName,
  );
  if (field === undefined) {
    throw new Error("Unrecognized field name: " + fieldQuery.fieldName);
  }

  const values: string[] = stripLeadingAndTrainingQuotationMarks(
    fieldQuery.value,
  )
    .split("AND")
    .flatMap((x) => x.split("OR"))
    .map((x) => x.trim())
    .map((x) => stripLeadingAndTrainingQuotationMarks(x));

  return values.map((value) => {
    return { term: { [field as string]: value } };
  });
}

function basicFieldQuery(fieldQuery: FieldQuery) {
  const fields: string[] = Array.of(
    getElasticSearchField(fieldQuery.fieldName),
  ).filter((x): x is string => x !== undefined);

  const obj: any = keywordQuery(fieldQuery.value, fields);
  return [obj];
}

/**
 * For general field query, use a keyword (i.e. "query_string") query.
 * For exact field match, use "term" query.
 * - term" searches for an exact term (with no additional text before or after).
 * - It is case-sensitive and does not analyze the search term.
 * - You can optionally set a parameter to ignore case,
 * - but this is NOT applied in the cultural heritage API.
 * - It is only for fields that non-analyzed (i.e. indexed as "keyword")
 */
function singleFieldQuery(
  fieldQuery: FieldQuery,
  exactFieldMatch: boolean,
): any[] {
  if (fieldQuery.fieldName.endsWith(".before")) {
    return rangeQuery(fieldQuery, true);
  } else if (fieldQuery.fieldName.endsWith(".after")) {
    // Range query
    return rangeQuery(fieldQuery, false);
  } else if (exactFieldMatch) {
    // Exact match query
    return exactMatchQuery(fieldQuery);
  } else {
    // Basic field query
    return basicFieldQuery(fieldQuery);
  }
}

/**
 * Strip leading and trailing quotation marks only if there are no
 * internal quotation marks.
 */

function stripLeadingAndTrainingQuotationMarks(str: string): string {
  if (str.match('^"[^"]*"$')) {
    return str.slice(1).slice(-1);
  } else {
    return str;
  }
}

/**
 * Composes an aggregates (facets) query object.
 * Fields must be non-analyzed (i.e. indexed as keyword)
 */
function aggs(facets: string[] | undefined, facetSize: number): any {
  if (!facets) return {};
  let base: any = {};
  // Iterate through each facet and add a field to the base JsObject
  for (let facet of facets) {
    if (coordinatesField.name === facet.split(":")[0]) {
      // Spatial facet
      const cleanFacetName = facet.split(":")[0];
      const coordinates = facet.split(":").slice(1).join(",");
      const ranges: any[] = [];

      for (let i = 0; i < 2000; i += 100) {
        ranges.push({ from: i, to: i + 99 });
      }

      ranges.push({ from: 2100 });

      const geoDistance = {
        geo_distance: {
          field: coordinatesField.elasticSearchDefault,
          origin: coordinates,
          unit: "mi",
          ranges: ranges,
        },
      };
      base.set(cleanFacetName, geoDistance);
    } else if (dateFields.map((x) => x.name).includes(facet)) {
      // Dates facet
      const esField = getElasticSearchField(facet);
      if (esField === undefined) {
        throw Error("Unrecognized facet name: " + facet);
      }

      const foo = facet.split("\\.")[-1];
      const interval = "month" === foo ? "month" : "year";

      const bar = facet.split("\\.")[-1];
      const format = "month" === bar ? "yyyy-MM" : "yyyy";

      const baz = facet.split("\\.")[-1];
      const gte = "month" === baz ? "now-416y" : "now-2000y";

      const dateHistogram = {
        filter: {
          range: {
            esField: {
              gte: gte,
              lte: "now",
            },
          },
        },
        aggs: {
          facet: {
            date_histogram: {
              field: esField,
              interval: interval,
              format: format,
              min_doc_count: 1,
              order: {
                _key: "desc",
              },
            },
          },
        },
      };

      base = {
        ...base,
        facet: dateHistogram,
      };
    } else {
      // Regular facet
      const terms = {
        terms: {
          field: getElasticSearchExactMatchField(facet),
          size: facetSize,
        },
      };

      base = {
        ...base,
        facet: terms,
      };
    }
  }
  return base;
}

function sort(params: SearchParams): any {
  const defaultSort = ["_score", "_doc"];

  // This is the fastest way to sort documents but is meaningless.
  // It is the order in which they are saved to disk.
  const diskSort = ["_doc"];

  if (params.sortBy) {
    const sortBy = params.sortBy;
    if (coordinatesField.name === sortBy) {
      // Geo sort
      if (params.sortByPin) {
        return [
          {
            _geo_distance: {
              coordinates: params.sortByPin,
              order: "asc",
              unit: "mi",
            },
          },
          "_score",
          "_doc",
        ];
      } else {
        return defaultSort;
      }
    } else {
      // Regular sort
      const foo = getElasticSearchNotAnalyzed(sortBy);
      if (foo) {
        return [
          {
            esField: {
              order: params.sortOrder,
            },
          },
          "_score",
          "_doc",
        ];
      } else {
        return defaultSort;
      }
    }
  } else {
    // No sort_by parameter
    if (!params.q && params.fieldQueries.length === 0) {
      return diskSort;
    } else {
      return defaultSort;
    }
  }
}

function fieldRetrieval(fields?: string[]): any {
  return fields ? fields.map(getElasticSearchField) : ["*"];
}
