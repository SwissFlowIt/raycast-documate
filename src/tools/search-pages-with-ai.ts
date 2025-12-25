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

type Filters = {
  strategy: "snippets" | "full";
  text_search: string | null;
  use_text_query: boolean;
  author_raw: string | null;
  author_username_hint: string | null;
  workspace: string | null;
  date_field: "sys_updated_on" | "sys_created_on";
  date_start: string | null; // YYYY-MM-DD
  date_end: string | null; // YYYY-MM-DD
  sort_by: "sys_updated_on" | "sys_created_on" | "relevance";
  sort_order: "desc" | "asc";
  limit: number;
};

const DEFAULT_FILTERS: Filters = {
  strategy: "snippets",
  text_search: null,
  use_text_query: true,
  author_raw: null,
  author_username_hint: null,
  workspace: null,
  date_field: "sys_updated_on",
  date_start: null,
  date_end: null,
  sort_by: "sys_updated_on",
  sort_order: "desc",
  limit: 3,
};

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

function buildFieldLikeQuery(userQuery: string): string {
  // Mirrors your existing UI command strategy for narrow searches
  const { phrases, terms } = parseSearchText(normalizeText(userQuery));
  const tokens = [...phrases, ...terms];

  return tokens
    .map(
      (t) =>
        `^titleLIKE${t}^ORsubtitleLIKE${t}^ORcontentLIKE${t}^ORworkspace.nameLIKE${t}^ORparent.titleLIKE${t}`
    )
    .join("");
}

function buildEncodedQuery(
  filters: Filters,
  originalUserQuery: string
): string {
  const conditions: string[] = ["workspace.active=true"];

  // Text query
  if (filters.text_search) {
    const q = normalizeText(filters.text_search);

    if (filters.use_text_query) {
      // You can use 123TEXTQUERY321 directly. GOTO is often unnecessary.
      conditions.push(`123TEXTQUERY321=${q}`);
    } else {
      // Narrow search: use LIKE over relevant fields, like your current command.
      conditions.push(buildFieldLikeQuery(q));
    }
  } else {
    // Fallback if model returns null text_search
    conditions.push(buildFieldLikeQuery(originalUserQuery));
  }

  // Author
  const author = filters.author_username_hint ?? filters.author_raw;
  if (author) {
    // Note: OR precedence in encoded queries can be surprising.
    // Keep it simple, and place this condition as a single chunk.
    conditions.push(
      `sys_created_byLIKE${author}^ORsys_updated_byLIKE${author}`
    );
    // If you see weird results, we can switch to a ^NQ-based duplication strategy.
  }

  // Workspace name (dot-walk)
  if (filters.workspace) {
    conditions.push(`workspace.nameLIKE${filters.workspace}`);
  }

  // Date range
  const df = filters.date_field || "sys_updated_on";
  if (filters.date_start) {
    conditions.push(`${df}>=${filters.date_start}`);
  }
  if (filters.date_end) {
    conditions.push(`${df}<=${filters.date_end}`);
  }

  // Sorting
  let orderClause = "";
  if (filters.sort_by === "relevance" && filters.use_text_query) {
    // Table API relevance ordering is not always exposed as a normal ORDERBY.
    // Leaving it empty often lets the platform decide.
    orderClause = "";
  } else {
    const sortBy =
      filters.sort_by === "sys_created_on"
        ? "sys_created_on"
        : "sys_updated_on";
    const dir = filters.sort_order === "asc" ? "ORDERBY" : "ORDERBYDESC";
    orderClause = `^${dir}${sortBy}`;
  }

  return conditions.join("^") + orderClause;
}

export default async function SearchPagesAI(input: Input) {
  const { query } = input;

  const today = new Date().toISOString().slice(0, 10);

  const parsingPrompt = `
You are a query parser for ServiceNow.
Translate the user request to English.
Produce a JSON object that can be translated into a ServiceNow sysparm_query.

Context:
- Searchable fields: title, subtitle, content, workspace.name, parent.title
- Date fields: sys_created_on, sys_updated_on
- Author fields: sys_updated_by, sys_created_by (username)
- Full-text option: 123TEXTQUERY321

Current date (YYYY-MM-DD): ${today}

User request:
"${query}"

Output requirements:
- Return ONLY valid JSON. No markdown, no code fences, no comments.
- Use null when unknown.

JSON schema (must be valid JSON):
{
  "english_request": "",
  "strategy": "",
  "intent": "",
  "text_search": null,
  "use_text_query": true,
  "author_raw": null,
  "author_username_hint": null,
  "workspace": null,
  "date_field": "sys_updated_on",
  "date_start": null,
  "date_end": null,
  "sort_by": "sys_updated_on",
  "sort_order": "desc",
  "limit": 3
}

Allowed values:
- strategy: "snippets" or "full",
- intent: "open" or "search"
- date_field: "sys_updated_on" or "sys_created_on"
- sort_by: "sys_updated_on" or "sys_created_on" or "relevance"
- sort_order: "desc" or "asc"
- limit: integer from 1 to 10


Rules:
1) english_request:
- Translate the user request to English.

2) intent:
- "open" if user explicitly asks to open (open, open it).
- otherwise "search".

3) Latest:
- If user asks for last/latest/most recent, set sort_order="desc".

4) Created vs updated:
- If user mentions created, set date_field="sys_created_on" and sort_by="sys_created_on".
- If user mentions updated/modified/edited, set date_field="sys_updated_on" and sort_by="sys_updated_on".
- Default to updated.

5) Time expressions:
- Resolve relative dates to absolute using Current date.
- Examples: today, yesterday, last week (start = 7 days ago, end = current date).
- If no date implied, date_start/date_end = null.

6) Text search:
- text_search must be in English.
- Remove filler phrases like "when did we talk", "conversation", "please", etc.
- use_text_query = true for broad conceptual queries (best practices, guidelines, how-to).
- use_text_query = false for narrow queries (exact title fragments, known identifiers).
- don't use words (like "last", "next", "ruben") that could go in other fields.
- don't repeated terms ("demo" and "demonstration" -> "demo").

7) Author:
- If an author is mentioned, set author_raw to the fragment exactly as written.
- Set author_username_hint ONLY if the user already provided a username-like token.
- Do NOT invent usernames.

8) Workspace:
- If workspace name is mentioned, set workspace to the name as written (preserve casing and emojis).

9) Strategy:
- Prefer "snippets" when the answer depends on facts inside content, but only small portions are needed.
- Use "full" only when the question requires reading long context across a page.


Return ONLY the JSON object.`.trim();

  let filters: Filters = { ...DEFAULT_FILTERS };
  try {
    const aiResponse = await AI.ask(parsingPrompt, { creativity: 0 });
    const cleanJson = extractFirstJsonObject(aiResponse);
    filters = {
      ...DEFAULT_FILTERS,
      ...(JSON.parse(cleanJson) as Partial<Filters>),
    };
  } catch (e) {
    console.error("AI parsing failed, falling back to field LIKE search", e);
    filters = { ...DEFAULT_FILTERS, text_search: query, use_text_query: false };
  }

  const encodedQuery = buildEncodedQuery(filters, query);

  const preferences = getPreferenceValues<Preferences>();
  const instanceUrl = getInstanceUrl(preferences.instance);
  const auth = createBasicAuthorizationHeader(
    preferences.username,
    preferences.password
  );

  const limit = Math.max(3, Math.min(filters.limit ?? 3, 10));

  const url =
    `${instanceUrl}/api/now/table/x_sft_documate_page` +
    `?sysparm_exclude_reference_link=true` +
    `&sysparm_query=${encodedQuery}` +
    `&sysparm_fields=sys_id,title,subtitle,workspace,workspace.name,content,sys_updated_by,sys_updated_on,sys_created_by,sys_created_on` +
    `&sysparm_limit=${limit}`;

  console.log("Fetching ServiceNow with sysparm_query:", url);
  const response = await fetch(url, { headers: { Authorization: auth } });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ServiceNow error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as { result: Page[] };
  console.log("ServiceNow response data:", data);
  const pages = data.result || [];

  if (pages.length === 0) {
    return "No documentation pages matching the search were found.";
  }

  const contextForAI = pages
    .map(
      (page, index) => `
    [RESULT ${index + 1}]
    Title: ${page.title}
    Workspace: ${page["workspace.name"]}
    Author: ${page.sys_updated_by}
    Created: ${page.sys_created_on}
    Last update: ${page.sys_updated_on}
    Content:
    """
    ${page.content}
    """
    -----------------------------------
  `
    )
    .join("\n");

  console.log(
    "Retrieved pages:",
    pages.map((p) => p.title)
  );

  return contextForAI;
}
