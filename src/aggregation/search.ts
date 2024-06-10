import { Client } from "@elastic/elasticsearch";
import { getFetchIds, getSearchParams } from "./param_validator";
import { composeMultiFetchQuery, composeSearchQuery } from "./query_builder";
import { mapSearchResponse } from "./dpla_map_mapper";

import {
  FourHundredResponse,
  InternalErrorResponse,
  InvalidParameter,
  TooManyIdentifiers,
  UnrecognizedParameters,
  DPLADocList,
  FiveHundredResponse,
} from "./responses";

export default class SearchController {
  esClient: Client;

  constructor(esClient: Client) {
    this.esClient = esClient;
  }

  public async getItem(
    itemID: string,
    queryParams: Map<string, string>,
    indexName: string,
  ): Promise<DPLADocList | FourHundredResponse | FiveHundredResponse> {
    const potentialFetchIds = getFetchIds(itemID, queryParams);

    if (
      potentialFetchIds instanceof UnrecognizedParameters ||
      potentialFetchIds instanceof TooManyIdentifiers ||
      potentialFetchIds instanceof InvalidParameter
    ) {
      return Promise.resolve(potentialFetchIds);
    }

    // multi-fetch
    const query = composeMultiFetchQuery(potentialFetchIds);

    let response;

    try {
      response = await this.esClient.search({
        index: indexName,
        body: query,
      });
    } catch (e: any) {
      console.log("Caught error from ES request. Item ID:", itemID, e);
      return Promise.resolve(new InternalErrorResponse());
    }

    return mapSearchResponse(response.body);
  }

  public async search(
    queryParams: Map<string, string>,
    indexName: string,
  ): Promise<DPLADocList | FourHundredResponse | FiveHundredResponse> {
    const searchParams = getSearchParams(queryParams);

    if (
      searchParams instanceof UnrecognizedParameters ||
      searchParams instanceof InvalidParameter
    ) {
      return Promise.reject(searchParams);
    }

    const query = composeSearchQuery(searchParams);

    let response;

    try {
      response = await this.esClient.search({
        index: indexName,
        body: query,
      });
    } catch (e: any) {
      console.log("Caught error from ES request. Query:", query, e);
      return Promise.resolve(new InternalErrorResponse());
    }

    return mapSearchResponse(response.body, query);
  }
}
