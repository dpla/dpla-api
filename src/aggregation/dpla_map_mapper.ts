import { SearchParams } from "./param_validator";
import { DPLADocList } from "./responses";

export function mapSearchResponse(
  response: any,
  searchParams?: SearchParams,
): DPLADocList {
  if (!searchParams) {
    return {
      count: response.hits.total.value,
      docs: response.hits.hits.map((hit: any) => hit._source),
    };
  } else {
    let mapped = response.hits.hits.map((hit: any) => hit._source);
    if (searchParams.fields) {
      mapped = unNestFields(mapped.docs, searchParams.fields);
    }

    const start = getStart(searchParams.page, searchParams.pageSize);
    const limit = searchParams.pageSize;

    const results: DPLADocList = new DPLADocList(mapped);
    results.count = mapped.length;

    start && (results.start = start);
    limit && (results.limit = limit);

    //todo facets

    console.log(response);
    return results;
  }
}

function getStart(page: number, pageSize: number): number {
  return (page - 1) * pageSize + 1;
}

function unNestFields(docs: any[], fields: string[]): any[] {
  return docs.map((doc) => {
    const docFields: any = {};
    for (let field of fields) {
      const fieldSeq: string[] = field.split("\\.");

      readUnknown(doc.asJsObject, fieldSeq).foreach((json: any) => {
        docFields.set(field, json);
      });
    }

    return docFields;
  });
}

function readUnknown(parent: Object, children: string[]): any | unknown {
  //not worried about recursion blowing the stack here because the depth of the fields is limited

  const childField = children.length > 0 ? children[0] : null;
  const nextChildren = children.length > 0 ? children.slice(1) : [];

  const end = nextChildren.length < 1;

  if (!childField || !parent.hasOwnProperty(childField)) {
    return null;
  }

  const child: any = parent[childField as keyof typeof parent];

  if (child instanceof Array) {
    return child.length === 1 ? child[0] : child;
  } else if (
    child instanceof String ||
    child instanceof Number ||
    child instanceof Boolean
  ) {
    return end ? child : null;
  } else if (child instanceof Object) {
    return end ? child : readUnknown(child, nextChildren);
  } else {
    return null;
  }
}
