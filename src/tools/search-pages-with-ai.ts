import { AI, getPreferenceValues } from "@raycast/api";
import {
  createBasicAuthorizationHeader,
  getInstanceUrl,
} from "../lib/servicenow";
import { Page } from "../api/types";
import { normalizeText, parseSearchText } from "../lib/searchText";

type Input = {
  /* The natural language query or keywords to search for */
  query: string;
};

type Field = {
  field:
    | "title"
    | "subtitle"
    | "content"
    | "workspace.name"
    | "parent.title"
    | "sys_created_by"
    | "sys_updated_by"
    | "sys_updated_on"
    | "sys_created_on";
  op: string;
  value: string;
};

type Block = {
  text_search?: string;
  filters?: Field[];
};

type SearchPlan = {
  strategy: "snippets" | "full";
  blocks: Block[];
  sort_by?: Field["field"];
  sort_order?: "desc" | "asc";
  limit: number;
};

const DEFAULT_PLAN: SearchPlan = {
  strategy: "snippets",
  blocks: [],
  sort_by: "sys_updated_on",
  sort_order: "desc",
  limit: 3,
};

const LIKE_OPERATORS = new Set(["LIKE", "NOT LIKE", "STARTSWITH", "ENDSWITH"]);
const TEXT_SEARCH_RECENCY_PATTERNS: RegExp[] = [
  /\bmost\s+recent(?:ly)?\b/gi,
  /\b(latest|newest|recent(?:ly)?|last|upcoming|next)\b/gi,
  /\b(últim(?:o|a)|ultim(?:o|a)|m[aá]s\s+reciente|reciente|pr[oó]xim(?:o|a)|siguiente)\b/gi,
];

function sanitizeEncodedQueryValue(value: string): string {
  // Avoid breaking encoded queries with separators/newlines.
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/\^/g, " ")
    .trim();
}

function normalizeLikeFilterValue(op: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  const normalizedOp = op.trim().toUpperCase();
  if (!LIKE_OPERATORS.has(normalizedOp)) return trimmed;

  let normalized = trimmed;
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }

  normalized = normalized.replace(/^%+/, "").replace(/%+$/, "").trim();
  return normalized;
}

function normalizeRelativeFilterValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  // Already in ServiceNow relative format.
  if (/^@[^@]+@ago@\d+$/i.test(trimmed)) return trimmed;

  // Allow advanced ServiceNow date expressions as-is.
  if (/^javascript:/i.test(trimmed)) return trimmed;

  const normalized = trimmed.toLowerCase();

  const relativeUnitAliases: Record<string, string> = {
    minute: "minute",
    minutes: "minute",
    min: "minute",
    mins: "minute",

    hour: "hour",
    hours: "hour",
    hr: "hour",
    hrs: "hour",

    day: "day",
    days: "day",

    week: "week",
    weeks: "week",

    month: "month",
    months: "month",
    mo: "month",

    year: "year",
    years: "year",
    yr: "year",
    yrs: "year",
  };

  const wordNumbers: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  };

  if (normalized === "yesterday" || normalized === "ayer") {
    return "@day@ago@1";
  }

  const lastUnit = normalized.match(
    /^(?:the\s+)?last\s+(minute|hour|day|week|month|year)s?$/
  );
  if (lastUnit) {
    return `@${lastUnit[1]}@ago@1`;
  }

  const quantityMatch = normalized.match(
    /^(\d+|[a-záéíóúñ]+)\s+([a-záéíóúñ]+)\s*(?:ago|hace)?\s*$/i
  );
  if (!quantityMatch) return trimmed;

  const rawCount = quantityMatch[1];
  const rawUnit = quantityMatch[2];

  const count = /^\d+$/.test(rawCount)
    ? Number(rawCount)
    : wordNumbers[rawCount];
  const unit = relativeUnitAliases[rawUnit];

  if (!count || count < 0 || !unit) return trimmed;
  return `@${unit}@ago@${count}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getAuthorFilterValues(plan: SearchPlan): string[] {
  const values: string[] = [];
  const blocks = Array.isArray(plan.blocks) ? plan.blocks : [];

  for (const block of blocks) {
    const filters = Array.isArray(block.filters) ? block.filters : [];
    for (const filter of filters) {
      if (
        filter.field !== "sys_created_by" &&
        filter.field !== "sys_updated_by"
      ) {
        continue;
      }

      const op = filter.op?.trim() ?? "";
      const value = filter.value?.trim() ?? "";
      if (!op || !value) continue;

      const normalized = normalizeLikeFilterValue(op, value);
      if (normalized) values.push(normalized);
    }
  }

  return Array.from(new Set(values));
}

function stripTextSearchNoise(
  textSearch: string,
  authorValues: string[]
): string {
  let cleaned = textSearch;

  // Remove recency/ordering qualifiers; handle those with sort/date filters instead.
  for (const pattern of TEXT_SEARCH_RECENCY_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }

  // Remove author name(s) when they are already expressed as metadata filters.
  for (const author of authorValues) {
    const escaped = escapeRegExp(author);
    cleaned = cleaned.replace(
      new RegExp(`\\b${escaped}(?:[’']s)?\\b`, "gi"),
      " "
    );
  }

  // Remove dangling possessives after stripping names (e.g. "'s trip").
  cleaned = cleaned.replace(/(^|\s)[’']s\b/gi, " ");

  return cleaned.replace(/\s+/g, " ").trim();
}

function postProcessSearchPlan(
  plan: SearchPlan,
  fallbackQuery: string
): SearchPlan {
  const blocks = Array.isArray(plan.blocks) ? plan.blocks : [];
  const authorValues = getAuthorFilterValues(plan);

  const cleanedBlocks: Block[] = [];

  for (const block of blocks) {
    const filters = Array.isArray(block.filters) ? block.filters : [];
    const rawTextSearch = block.text_search?.trim();
    const cleanedTextSearch = rawTextSearch
      ? stripTextSearchNoise(rawTextSearch, authorValues)
      : undefined;

    if (!cleanedTextSearch && filters.length === 0) continue;

    cleanedBlocks.push({
      ...block,
      text_search: cleanedTextSearch || undefined,
      filters,
    });
  }

  return cleanedBlocks.length > 0
    ? { ...plan, blocks: cleanedBlocks }
    : { ...plan, blocks: [{ text_search: fallbackQuery, filters: [] }] };
}

function buildEncodedQuery(plan: SearchPlan, fallbackQuery: string): string {
  const blocks =
    Array.isArray(plan.blocks) && plan.blocks.length > 0
      ? plan.blocks
      : [{ text_search: fallbackQuery, filters: [] }];

  const unaryOps = new Set([
    "ISEMPTY",
    "ISNOTEMPTY",
    "EMPTYSTRING",
    "ISNULL",
    "ISNOTNULL",
    "ANYTHING",
  ]);

  const relativeOps = new Set([
    "RELATIVEEE",
    "RELATIVEGE",
    "RELATIVEGT",
    "RELATIVELE",
    "RELATIVELT",
  ]);

  const blockQueries: string[] = [];

  for (const block of blocks) {
    const parts: string[] = [];

    const textSearch = block.text_search?.trim();
    if (textSearch) {
      // ServiceNow full-text encoded query token.
      parts.push(`123TEXTQUERY321=${sanitizeEncodedQueryValue(textSearch)}`);
    }

    const filters = Array.isArray(block.filters) ? block.filters : [];
    for (const f of filters) {
      const field = f.field?.trim();
      const op = f.op?.trim();
      const value = f.value?.trim();

      if (!field || !op) continue;

      if (unaryOps.has(op)) {
        parts.push(`${field}${op}`);
        continue;
      }

      if (!value) continue;
      const normalizedValue = relativeOps.has(op)
        ? normalizeRelativeFilterValue(value)
        : value;
      const finalValue = normalizeLikeFilterValue(op, normalizedValue);
      if (!finalValue) continue;
      parts.push(`${field}${op}${sanitizeEncodedQueryValue(finalValue)}`);
    }

    if (parts.length > 0) {
      blockQueries.push(parts.join("^"));
    }
  }

  const baseQuery =
    blockQueries.length > 0
      ? blockQueries.join("^NQ") // OR across blocks
      : `123TEXTQUERY321=${sanitizeEncodedQueryValue(fallbackQuery)}`;

  const sortBy = plan.sort_by?.trim();
  const sortOrder = plan.sort_order?.trim();

  const withSort = sortBy
    ? `${baseQuery}^${sortOrder === "asc" ? "ORDERBY" : "ORDERBYDESC"}${sortBy}`
    : baseQuery;

  // Caller injects into URL; keep it URL-safe.
  return encodeURIComponent(withSort);
}

function buildEncodedQueriesForBlocks(
  plan: SearchPlan,
  fallbackQuery: string
): string[] {
  const blocks =
    Array.isArray(plan.blocks) && plan.blocks.length > 0
      ? plan.blocks
      : [{ text_search: fallbackQuery, filters: [] }];

  const queries = blocks.map((block) =>
    buildEncodedQuery({ ...plan, blocks: [block] }, fallbackQuery)
  );

  return Array.from(new Set(queries));
}

function extractFirstJsonObject(text: string): string {
  // Remove common fenced code blocks
  const withoutFences = text.replace(/```(?:json)?/g, "").trim();

  // Best-effort: take the first {...} block
  const firstBrace = withoutFences.indexOf("{");
  const lastBrace = withoutFences.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("No JSON object found in AI response");
  }
  return withoutFences.slice(firstBrace, lastBrace + 1);
}

function buildDocumatePageUrl(instanceUrl: string, page: Page): string {
  return `${instanceUrl}/x_sft_documate_app.do?w=${page.workspace}&p=${page.sys_id}`;
}

const SNIPPET_MAX_LENGTH = 240;
const SNIPPET_RADIUS = Math.floor(SNIPPET_MAX_LENGTH / 2);
const MIN_TOKEN_LENGTH = 3;

const PAGES_SYSPARM_FIELDS =
  "sys_id,title,subtitle,workspace,workspace.name,content,sys_updated_by,sys_updated_on,sys_created_by,sys_created_on";

async function fetchDocumatePages(
  instanceUrl: string,
  auth: string,
  encodedQuery: string,
  limit: number
): Promise<Page[]> {
  const url =
    `${instanceUrl}/api/now/table/x_sft_documate_page` +
    `?sysparm_exclude_reference_link=true` +
    `&sysparm_query=${encodedQuery}` +
    `&sysparm_fields=${PAGES_SYSPARM_FIELDS}` +
    `&sysparm_limit=${limit}`;

  // console.log("Fetching ServiceNow with sysparm_query:", encodedQuery);
  const response = await fetch(url, { headers: { Authorization: auth } });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ServiceNow error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as { result: Page[] };
  return data.result || [];
}

function sortPages(
  pages: Page[],
  sortBy: Field["field"],
  sortOrder: "desc" | "asc"
): Page[] {
  const direction = sortOrder === "asc" ? 1 : -1;

  return [...pages].sort((a, b) => {
    const aValue = String(a[sortBy as keyof Page] ?? "").trim();
    const bValue = String(b[sortBy as keyof Page] ?? "").trim();

    if (!aValue && !bValue) return 0;
    if (!aValue) return 1;
    if (!bValue) return -1;

    const cmp = aValue.localeCompare(bValue, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    return direction * cmp;
  });
}

function normalizeWithIndexMap(value: string): {
  normalized: string;
  indexMap: number[];
} {
  let normalized = "";
  const indexMap: number[] = [];
  let codeUnitIndex = 0;

  for (const char of value) {
    const normalizedChar = char
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    for (let i = 0; i < normalizedChar.length; i += 1) {
      normalized += normalizedChar[i];
      indexMap.push(codeUnitIndex);
    }

    codeUnitIndex += char.length;
  }

  return { normalized, indexMap };
}

function formatSnippet(content: string, start: number, end: number): string {
  const prefix = start > 0 ? "..." : "";
  const suffix = end < content.length ? "..." : "";
  return `${prefix}${content.slice(start, end).trim()}${suffix}`;
}

function buildSnippets(content: string, query: string): string[] {
  const { normalized, indexMap } = normalizeWithIndexMap(content);
  const { phrases, terms } = parseSearchText(normalizeText(query));
  const tokens = [...phrases, ...terms]
    .map((t) => t.trim())
    .filter((t) => t.length >= MIN_TOKEN_LENGTH)
    .sort((a, b) => b.length - a.length);

  const snippets: string[] = [];
  const ranges: Array<{ start: number; end: number }> = [];

  for (const token of tokens) {
    const matchIndex = normalized.indexOf(token);
    if (matchIndex === -1) continue;

    const matchStart = indexMap[matchIndex] ?? 0;
    const matchEnd =
      indexMap[Math.min(matchIndex + token.length - 1, indexMap.length - 1)] ??
      matchStart;
    const start = Math.max(0, matchStart - SNIPPET_RADIUS);
    const end = Math.min(content.length, matchEnd + 1 + SNIPPET_RADIUS);

    const overlaps = ranges.some(
      (range) => start <= range.end && end >= range.start
    );
    if (overlaps) continue;

    ranges.push({ start, end });
    snippets.push(formatSnippet(content, start, end));
  }

  if (snippets.length === 0) {
    const fallbackEnd = Math.min(content.length, SNIPPET_MAX_LENGTH);
    snippets.push(formatSnippet(content, 0, fallbackEnd));
  }

  return snippets;
}

export default async function SearchPagesAI(input: Input) {
  const { query } = input;

  const today = new Date().toISOString().slice(0, 10);

  const parsingPrompt = `
You are a query parser for ServiceNow.
Translate the user request to English.
Produce a JSON object that can be translated into a ServiceNow sysparm_query.

Context:
- Searchable fields: title, subtitle, content, parent.title, workspace.name, sys_created_by, sys_updated_by, sys_updated_on, sys_created_on
- Date fields: sys_created_on, sys_updated_on
- Author fields: sys_updated_by, sys_created_by (username)
- Full-text option: 123TEXTQUERY321

Current date (YYYY-MM-DD): ${today}

User request:
"${query}"

Output requirements:
- Return ONLY valid JSON. No markdown, no code fences, no comments.
- Do NOT output null. If a field is unknown or not applicable, OMIT it.

JSON schema (must be valid JSON):
{
  "type": "object",
  "additionalProperties": false,
  "required": ["strategy", "blocks", "limit"],
  "properties": {
    "strategy": { "type": "string", "enum": ["snippets", "full"] },
    "blocks": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/$defs/block" }
    },
    "sort_by": { "$ref": "#/$defs/field" },
    "sort_order": { "type": "string", "enum": ["asc", "desc"] },
    "limit": { "type": "integer", "minimum": 1, "maximum": 10 }
  },
  "$defs": {
    "field": {
      "type": "string",
      "enum": [
        "title",
        "subtitle",
        "content",
        "parent.title",
        "workspace.name",
        "sys_created_by",
        "sys_updated_by",
        "sys_updated_on",
        "sys_created_on"
      ]
    },
    "op": {
      "type": "string",
      "enum": [
        "=",
        "!=",
        "<",
        "<=",
        ">",
        ">=",
        "IN",
        "NOT IN",
        "BETWEEN",
        "LIKE",
        "NOT LIKE",
        "STARTSWITH",
        "ENDSWITH",
        "ISEMPTY",
        "ISNOTEMPTY",
        "EMPTYSTRING",
        "ISNULL",
        "ISNOTNULL",
        "ANYTHING",
        "SAMEAS",
        "NSAMEAS",
        "INSTANCEOF",
        "VALCHANGES",
        "CHANGESFROM",
        "CHANGESTO",
        "DYNAMIC",
        "GT_FIELD",
        "GT_OR_EQUALS_FIELD",
        "LT_FIELD",
        "LT_OR_EQUALS_FIELD",
        "MORETHAN",
        "LESSTHAN",
        "DATEPART",
        "RELATIVEEE",
        "RELATIVEGE",
        "RELATIVEGT",
        "RELATIVELE",
        "RELATIVELT",
        "ON",
        "NOTON"
      ]
    },
    "filter": {
      "type": "object",
      "additionalProperties": false,
      "required": ["field", "op", "value"],
      "properties": {
        "field": { "$ref": "#/$defs/field" },
        "op": { "$ref": "#/$defs/op" },
        "value": { "type": "string", "minLength": 1 }
      }
    },
    "block": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "text_search": { "type": "string", "minLength": 1 },
        "filters": {
          "type": "array",
          "items": { "$ref": "#/$defs/filter" }
        }
      }
    }
  }
}

Rules:
1) Limit:
- Pick the number that is likely to include the page(s) needed to answer.

2) Time expressions:
- For RELATIVE* operators, values must follow ServiceNow syntax like:
  - "@day@ago@30"
  - "@week@ago@2"
  - "@month@ago@1"
- If no date is implied, do not add any date filters.

3) Text search (full-text via 123TEXTQUERY321):
- Every term used in text_search must be in English.
- Remove filler phrases like "when did we talk", "conversation", "please", etc.
- Do NOT include ordering/recency words like "latest", "most recent", "newest", "last", "upcoming", "next" in text_search; use sort_by/sort_order instead.
- Do NOT include author names or workspace names in text_search when those are already expressed as filters.
- Keep each text_search short (focused on ONE variant).
- Never duplicate the exact same text_search across blocks.
- Avoid duplicating the same key terms across blocks; each block should introduce at least one meaningful synonym/variant.

4) Authors:
- sys_created_by and sys_updated_by are usernames.
- If the user mentions a first name or family name, match by substring using LIKE.
- If a full name is mentioned, try matching with both parts (still via LIKE).
- For LIKE / NOT LIKE / STARTSWITH / ENDSWITH, output the raw substring only (do NOT wrap in % wildcards).
- Prefer sys_created_by when the user asks who planned/created/wrote something; prefer sys_updated_by when the user asks who updated/edited it.

5) Workspace handling:
- If the user mentions a workspace by name, add a filter
  { "field": "workspace.name", "op": "=", "value": "<workspace name>" }
  to EVERY block.
- Do NOT guess a workspace if the user does not mention any.

6) Strategy:
- Prefer "snippets" when the answer depends on facts inside content, but only small portions are needed.
- Use "full" only when the question requires reading long context across a page.

7) Filters usage:
- Use filters only for structured constraints (authors, dates, workspace, parent title, etc.).
- Prefer:
  - sys_created_by / sys_updated_by for author constraints.
  - sys_created_on / sys_updated_on for date constraints.
  - workspace.name when a workspace is mentioned.
- Do NOT use filters on "content" when "text_search" is present.

8) Synonym and intent expansion:
- Identify the user's intent as (action + object) in English.
- Prefer multiple blocks over one long text_search string.
- Avoid stuffing many synonyms into a single block.
- Include at least one block expanding relevant acronyms when present (e.g., "PDI" -> "personal developer instance").
- If the user mentions a workspace, apply the workspace filter to EVERY block.
- If the user mentions an author, apply the author filter to EVERY block.

9) Block validity:
- In each block, "text_search" and "filters" are optional, but at least ONE must be present:
  - text_search (non-empty), OR
  - filters (non-empty array).

Return ONLY the JSON object.`.trim();

  let plan: SearchPlan = { ...DEFAULT_PLAN };
  try {
    const aiResponse = await AI.ask(parsingPrompt, { creativity: 0 });
    const cleanJson = extractFirstJsonObject(aiResponse);
    plan = {
      ...DEFAULT_PLAN,
      ...(JSON.parse(cleanJson) as Partial<SearchPlan>),
    };
  } catch (e) {
    console.error("AI parsing failed, falling back to field LIKE search", e);
    plan = {
      ...DEFAULT_PLAN,
      blocks: [{ text_search: query, filters: [] }],
    };
  }

  if (!Array.isArray(plan.blocks) || plan.blocks.length === 0) {
    plan.blocks = [{ text_search: query, filters: [] }];
  }

  plan = postProcessSearchPlan(plan, query);

  // console.log("Derived search plan from AI:", JSON.stringify(plan));

  const preferences = getPreferenceValues<Preferences>();
  const instanceUrl = getInstanceUrl(preferences.instance);
  const auth = createBasicAuthorizationHeader(
    preferences.username,
    preferences.password
  );

  const limit = Math.max(2, Math.min(plan.limit ?? 3, 10));

  const needsMultipleQueries =
    plan.blocks.length > 1 &&
    plan.blocks.some((block) => Boolean(block.text_search?.trim()));

  // ServiceNow does not support OR (^NQ) when using 123TEXTQUERY321, so fan out.
  const encodedQueries = needsMultipleQueries
    ? buildEncodedQueriesForBlocks(plan, query)
    : [buildEncodedQuery(plan, query)];

  const perQueryLimit = limit;
  const results = await Promise.allSettled(
    encodedQueries.map((encodedQuery) =>
      fetchDocumatePages(instanceUrl, auth, encodedQuery, perQueryLimit)
    )
  );

  const rawPages: Page[] = [];
  const errors: string[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      rawPages.push(...result.value);
    } else {
      const message =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      errors.push(message);
      console.error("ServiceNow query failed:", message);
    }
  }

  if (rawPages.length === 0 && errors.length > 0) {
    throw new Error(errors[0]);
  }

  const dedupedPages = Array.from(
    new Map(rawPages.map((p) => [p.sys_id, p])).values()
  );

  const sortBy = plan.sort_by ?? "sys_updated_on";
  const sortOrder = plan.sort_order ?? "desc";
  const pages = sortPages(dedupedPages, sortBy, sortOrder).slice(0, limit);

  if (pages.length === 0) {
    return "No documentation pages matching the search were found.";
  }

  const useSnippets = plan.strategy === "snippets";
  const snippetQuery = [
    query,
    ...Array.from(
      new Set(
        plan.blocks
          .map((block) => block.text_search?.trim())
          .filter((textSearch): textSearch is string => Boolean(textSearch))
      )
    ),
  ]
    .join(" ")
    .trim();
  const responseGuidance =
    "When answering, include the Documate URL for any page you cite.";

  const contextForAI = [
    responseGuidance,
    "",
    pages
      .map((page, index) => {
        const contentHeader = useSnippets ? "Snippets" : "Content";
        const snippets = useSnippets
          ? buildSnippets(page.content, snippetQuery)
          : [];
        const contentBody = useSnippets
          ? snippets.length > 0
            ? snippets.map((snippet) => `- ${snippet}`).join("\n")
            : "(No content available)"
          : page.content;
        const documateUrl = buildDocumatePageUrl(instanceUrl, page);

        return `
    [RESULT ${index + 1}]
    Title: ${page.title}
    Workspace: ${page["workspace.name"] ?? "(unknown)"}
    Author: ${page.sys_updated_by}
    Created: ${page.sys_created_on ?? "(unknown)"}
    Last update: ${page.sys_updated_on}
    Documate URL: ${documateUrl}
    ${contentHeader}:
    """
    ${contentBody}
    """
    -----------------------------------
  `;
      })
      .join("\n"),
  ].join("\n");

  // console.log("Context for AI:\n", contextForAI);

  return contextForAI;
}
