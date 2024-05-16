import { Client } from "@elastic/elasticsearch";

interface ItemResponse {}

export default class SearchController {
  esClient: Client;

  constructor(esClient: Client) {
    this.esClient = esClient;
  }

  public async getItem(
    itemID: string,
    indexName: string,
  ): Promise<ItemResponse> {
    const response = await this.esClient.get({
      index: indexName,
      id: itemID,
    });

    const record = response.body._source;

    return record;
  }
}
