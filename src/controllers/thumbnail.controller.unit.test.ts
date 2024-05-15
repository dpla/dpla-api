import { Headers } from "node-fetch";
import ThumbnailController from "./thumbnail";
import { SQS } from "@aws-sdk/client-sqs";
import { S3 } from "@aws-sdk/client-s3";
import { Client } from "@elastic/elasticsearch";

const s3Mock = jest.genMockFromModule<S3>("@aws-sdk/client-s3");
const sqsMock = jest.genMockFromModule<SQS>("@aws-sdk/client-sqs");
const esClientMock = jest.genMockFromModule<Client>("@elastic/elasticsearch");

const thumb = new ThumbnailController("foo", s3Mock, sqsMock, esClientMock);

test("getItemId", () => {
  const testData = {
    "/thumb/223ea5040640813b6c8204d1e0778d30":
      "223ea5040640813b6c8204d1e0778d30",
    "/thumb/11111111111111111111111111111111":
      "11111111111111111111111111111111",
    "/thumb//11111111111111111111111111111111": null,
    "/thumb/111111111111111111111111111111111/": null,
    "/thumb/oneoneoneoneoneoneoneoneoneoneon": null,
    "223ea5040640813b6c8204d1e0778d30": null,
    "/thumb": null,
    "/thumb/": null,
    "/thumb/1234": null,
  };

  Object.entries(testData).forEach(([key, value]) => {
    const result = thumb.getItemId(key);
    expect(result).toBe(value);
  });
});

test("getImageUrlFromSearchResult: String", async () => {
  const test1 = {
    _source: {
      object: "http://google.com",
    },
  };
  const result1 = await thumb.getImageUrlFromSearchResult(test1);
  expect(result1).toBe("http://google.com");
});

test("getImageUrlFromSearchResult: Array", async () => {
  const test = {
    _source: {
      object: ["http://google.com"],
    },
  };
  const result = await thumb.getImageUrlFromSearchResult(test);
  expect(result).toBe("http://google.com");
});

test("getImageUrlFromSearchResult: Bad URL", async () => {
  const test = {
    _source: {
      object: ["blah:hole"],
    },
  };
  expect.assertions(1);
  try {
    await thumb.getImageUrlFromSearchResult(test);
  } catch (error) {
    expect(error).toMatch("URL was malformed.");
  }
});

test("getImageUrlFromSearchResult: Empty result", async () => {
  const test = {};
  expect.assertions(1);
  try {
    await thumb.getImageUrlFromSearchResult(test);
  } catch (error) {
    expect(error).toMatch("Couldn't find image URL in record.");
  }
});

test("getImageUrlFromSearchResult: Record has no thumbnail", async () => {
  const test = {
    _source: {
      foo: ["bar"],
    },
  };
  expect.assertions(1);
  try {
    await thumb.getImageUrlFromSearchResult(test);
  } catch (error) {
    expect(error).toMatch("Couldn't find image URL in record.");
  }
});

test("isProbablyURL", async () => {
  class TestCase {
    url: string;
    result: boolean;
    constructor(url: string, result: boolean) {
      this.url = url;
      this.result = result;
    }
  }
  [
    new TestCase("foo", false),
    new TestCase("gopher:hole", false),
    new TestCase("https://foo.com", true),
    new TestCase("http://foo.com", true),
    new TestCase("https://foo.com", true),
  ].forEach((testCase) => {
    expect(thumb.isProbablyURL(testCase.url)).toBe(testCase.result);
  });
});

test("getCacheHeaders", async () => {
  const result = thumb.getCacheHeaders(2);
  expect(result.get("Cache-Control")).toBe("public, max-age=2");
  expect(result.get("Expires")).toMatch(
    /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\W\d{2}\W(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\W\d{4}\W\d{2}:\d{2}:\d{2}\WGMT$/,
  );
});

test("withTimeout: pass", async () => {
  jest.useFakeTimers();
  const result = await thumb.withTimeout(3000, Promise.resolve("foo"));
  expect(result).toBe("foo");
});

test("withTimeout: too slow", async () => {
  jest.useFakeTimers();
  expect.assertions(1);

  try {
    await thumb.withTimeout(
      1000,
      //new Promise((resolve) => setTimeout(resolve, 5000)),
      Promise.resolve().then(() => jest.advanceTimersByTime(5000)),
    );
  } catch (error: any) {
    const message = error?.message as string;
    expect(message).toBe("Response from server timed out.");
  }
});

test("getRemoteImagePromise: Bad url", async () => {
  expect.assertions(1);
  const url =
    "https://localhost/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png";

  try {
    await thumb.getRemoteImagePromise(url);
  } catch (error: any) {
    expect(error).toBeDefined();
  }
});

test("setHeadersFromTarget", async () => {
  const headers = new Headers();
  headers.append("foo", "foo");
  headers.append("bar", "bar");
  headers.append("Content-Encoding", "text/plain");
  headers.append("Last-Modified", "Wed, 21 Oct 2015 07:28:00 GMT");
  const responseHeaders = thumb.getHeadersFromTarget(headers);
  expect(responseHeaders.get("Last-Modified")).toBe(
    headers.get("Last-Modified"),
  );
  expect(responseHeaders.get("foo")).toBeFalsy();
  expect(responseHeaders.get("bar")).toBeFalsy();
  expect(responseHeaders.get("Content-Encoding")).toBeFalsy();
});

test("getImageStatusCode", () => {
  const data = {
    200: 200,
    404: 404,
    410: 404,
    5: 502,
    100: 502,
    555: 502,
  };

  Object.entries(data).forEach(([value, expected]) => {
    expect(thumb.getImageStatusCode(Number(value))).toBe(expected);
  });
});
