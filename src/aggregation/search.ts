import { Client } from "@elastic/elasticsearch";
import { getFetchIds, getSearchParams } from "./param_validator";
import { composeMultiFetchQuery, composeSearchQuery } from "./query_builder";
import { DPLADocList, mapSearchResponse } from "./dpla_map_mapper";

import {
  BadResponse,
  InternalError,
  InvalidParameter,
  TooManyIdentifiers,
  UnrecognizedParameters,
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
  ): Promise<DPLADocList | BadResponse> {
    const potentialFetchIds = getFetchIds(itemID, queryParams);

    if (
      potentialFetchIds instanceof UnrecognizedParameters ||
      potentialFetchIds instanceof TooManyIdentifiers ||
      potentialFetchIds instanceof InvalidParameter
    ) {
      return Promise.reject(potentialFetchIds);
    }

    // multi-fetch
    const query = composeMultiFetchQuery(potentialFetchIds);

    try {
      const response = await this.esClient.search({
        index: indexName,
        body: query,
      });

      return mapSearchResponse(response.body);
    } catch (e: any) {
      // problem communicating with elasticsearch
      return Promise.reject(new InternalError());
    }
  }

  public async search(
    queryParams: Map<string, string>,
    indexName: string,
  ): Promise<DPLADocList | BadResponse> {
    const searchParams = getSearchParams(queryParams);

    if (
      searchParams instanceof UnrecognizedParameters ||
      searchParams instanceof InvalidParameter
    ) {
      return Promise.reject(searchParams);
    }

    const query = composeSearchQuery(searchParams);

    const response = await this.esClient.search({
      index: indexName,
      body: query,
    });

    return mapSearchResponse(response.body, query);
  }
}
