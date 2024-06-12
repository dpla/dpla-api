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
  InvalidEmail,
  EmailSent,
} from "./responses";
import ApiKeyRepository from "./api_key_repository";
import { createHash, getRandomValues } from "node:crypto";
import { Emailer } from "./Emailer";

export default class SearchController {
  private esClient: Client;
  private apiKeyRepository: ApiKeyRepository;
  private emailer: Emailer;

  constructor(
    esClient: Client,
    apiKeyRepository: ApiKeyRepository,
    emailer: Emailer,
  ) {
    this.esClient = esClient;
    this.apiKeyRepository = apiKeyRepository;
    this.emailer = emailer;
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

  public async createApiKey(
    email: string,
  ): Promise<InvalidEmail | InternalErrorResponse | EmailSent> {
    if (!this.apiKeyRepository.isValidEmail(email)) {
      return new InvalidEmail();
    }
    const lookupUser = await this.apiKeyRepository.findUserByEmail(email);
    let user = null;
    if (lookupUser !== null) {
      user = lookupUser;
    } else {
      const hash = createHash("md5");
      hash.update(email);
      hash.update(getRandomValues(new Uint8Array(32)));
      const key = hash.digest("hex");
      const staff = email.endsWith("@dp.la");
      try {
        await this.apiKeyRepository.createAccount(key, email, true, staff);
      } catch (e: any) {
        console.log("Caught error creating account for:", email, e);
        return Promise.resolve(new InternalErrorResponse());
      }
      user = {
        key,
        email,
        enabled: true,
        staff,
        created_at: new Date(),
        updated_at: new Date(),
      };
    }

    try {
      await this.emailer.sendEmail(
        email,
        "Your DPLA API Key",
        `Your DPLA API key is: ${user.key}`,
      );

      return Promise.resolve(new EmailSent(email));
    } catch (e: any) {
      console.log("Caught error sending email to:", email, e);
      return Promise.resolve(new InternalErrorResponse());
    }
  }
}
