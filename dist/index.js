#!/usr/bin/env node

// index.js
var fs = require("fs");
var path = require("path");
var CONFIG = {
  apiKey: process.env.INPUT_API_KEY || "",
  model: process.env.INPUT_MODEL || "deepseek-chat",
  baseUrl: process.env.INPUT_BASE_URL || "https://api.deepseek.com/v1",
  scanScope: process.env.INPUT_SCAN_SCOPE || "changed",
  language: process.env.INPUT_LANGUAGE || "zh-CN",
  maxTokens: parseInt(process.env.INPUT_MAX_TOKENS || "2000", 10)
};
var GITHUB = {
  token: process.env.GITHUB_TOKEN || "",
  repository: process.env.GITHUB_REPOSITORY || "",
  eventPath: process.env.GITHUB_EVENT_PATH || "",
  eventName: process.env.GITHUB_EVENT_NAME || ""
};
async function githubApi(endpoint, opts = {}) {
  const url = endpoint.startsWith("http") ? endpoint : `https://api.github.com/repos/${GITHUB.repository}/${endpoint.replace(/^\//, "")}`;
  const headers = {
    Authorization: `Bearer ${GITHUB.token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "CodeReviewBot/2.0",
    ...opts.headers
  };
  const resp = await fetch(url, { ...opts, headers });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`GitHub API ${resp.status}: ${body.slice(0, 300)}`);
  }
  return resp.json();
}
function getPRFromEvent() {
  if (!GITHUB.eventPath || !fs.existsSync(GITHUB.eventPath)) {
    throw new Error("\u65E0\u6CD5\u8BFB\u53D6 GitHub Event: event_path \u4E0D\u5B58\u5728");
  }
  const event = JSON.parse(fs.readFileSync(GITHUB.eventPath, "utf-8"));
  if (event.pull_request) {
    return {
      number: event.pull_request.number,
      title: event.pull_request.title,
      body: event.pull_request.body || "",
      base: event.pull_request.base.ref,
      head: event.pull_request.head.ref,
      headSha: event.pull_request.head.sha,
      url: event.pull_request._links?.html?.href || event.pull_request.html_url,
      diffUrl: event.pull_request.diff_url
    };
  }
  throw new Error(`\u4E0D\u652F\u6301\u7684\u4E8B\u4EF6\u7C7B\u578B: ${GITHUB.eventName}`);
}
function parseInlineFindings(reviewText) {
  const findings = [];
  const lines = reviewText.split("\n");
  let currentFinding = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/【位置】\s*(\S+)\s*:\s*(\d+)(?:\s*[-–]\s*(\d+))?/);
    if (match) {
      if (currentFinding) findings.push(currentFinding);
      const file = match[1];
      const lineNum = parseInt(match[2], 10);
      const endLine = match[3] ? parseInt(match[3], 10) : lineNum;
      let body = "";
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        if (lines[j].includes("\u3010\u4F4D\u7F6E\u3011")) break;
        if (lines[j].trim()) {
          body += lines[j].trim() + "\n";
        }
      }
      body = body.replace(/^【[^】]+】\s*/gm, "").trim();
      if (body) {
        currentFinding = { file, line: lineNum, endLine, body };
      }
    }
  }
  if (currentFinding) findings.push(currentFinding);
  return findings;
}
function buildInlineComments(findings, changedFiles) {
  return findings.filter((f) => changedFiles.some((cf) => cf.endsWith(f.file) || cf === f.file)).map((f) => ({
    path: f.file,
    line: f.line,
    side: "RIGHT",
    body: `\u{1F916} ${f.body}`
  }));
}
var SYSTEM_PROMPT = `\u4F60\u662F\u8D44\u6DF1\u5E94\u7528\u5B89\u5168\u5DE5\u7A0B\u5E08\u3002\u626B\u63CF\u4EE5\u4E0B\u4EE3\u7801\u53D8\u66F4\uFF0C\u53EA\u5173\u6CE8\u5B89\u5168\u95EE\u9898\u3002

## \u626B\u63CF\u7EF4\u5EA6
1. **\u6CE8\u5165\u653B\u51FB**\uFF1ASQL/NoSQL/\u547D\u4EE4/\u4EE3\u7801\u6CE8\u5165\u3001\u6A21\u677F\u6CE8\u5165
2. **\u654F\u611F\u6570\u636E**\uFF1A\u786C\u7F16\u7801\u5BC6\u94A5/Token/\u5BC6\u7801\u3001\u65E5\u5FD7\u6CC4\u9732\u3001API \u54CD\u5E94\u66B4\u9732
3. **\u8BA4\u8BC1\u6388\u6743**\uFF1A\u6743\u9650\u7ED5\u8FC7\u3001\u4F1A\u8BDD\u52AB\u6301\u3001OAuth \u914D\u7F6E\u9519\u8BEF
4. **\u4F9B\u5E94\u94FE**\uFF1A\u4E0D\u5B89\u5168\u4F9D\u8D56\u3001npm/pip \u5305\u6295\u6BD2\u3001\u7248\u672C\u9501\u5B9A\u7F3A\u5931
5. **\u52A0\u5BC6\u5B89\u5168**\uFF1A\u5F31\u52A0\u5BC6\u7B97\u6CD5\u3001\u786C\u7F16\u7801 IV\u3001\u968F\u673A\u6570\u4E0D\u5B89\u5168
6. **\u8F93\u5165\u9A8C\u8BC1**\uFF1AXSS\u3001\u8DEF\u5F84\u7A7F\u8D8A\u3001\u6587\u4EF6\u4E0A\u4F20\u3001SSRF\u3001\u53CD\u5E8F\u5217\u5316
7. **\u914D\u7F6E\u9519\u8BEF**\uFF1ACORS \u8FC7\u4E8E\u5BBD\u677E\u3001Debug \u6A21\u5F0F\u5F00\u542F\u3001\u7AEF\u53E3\u66B4\u9732

## \u8F93\u51FA\u683C\u5F0F\uFF08\u3010\u4F4D\u7F6E\u3011\u5FC5\u987B\u4E25\u683C\uFF0C\u7528\u4E8E\u81EA\u52A8\u884C\u5185\u8BC4\u8BBA\uFF09

### \u{1F534} \u4E25\u91CD\u6F0F\u6D1E\uFF08\u5FC5\u987B\u7ACB\u5373\u4FEE\u590D\uFF09
- \u3010\u4F4D\u7F6E\u3011\u6587\u4EF6\u540D:\u884C\u53F7
- \u3010\u6F0F\u6D1E\u3011CWE \u7F16\u53F7 + \u63CF\u8FF0
- \u3010\u98CE\u9669\u3011\u653B\u51FB\u573A\u666F
- \u3010\u4FEE\u590D\u3011\u4EE3\u7801\u793A\u4F8B

### \u{1F7E1} \u4E2D\u5371\u98CE\u9669
- \u3010\u4F4D\u7F6E\u3011\u6587\u4EF6\u540D:\u884C\u53F7
- \u3010\u98CE\u9669\u3011\u63CF\u8FF0
- \u3010\u4FEE\u590D\u3011\u5EFA\u8BAE

### \u{1F4CA} \u5B89\u5168\u8BC4\u5206
- \u4E25\u91CD: X \u4E2A
- \u4E2D\u5371: X \u4E2A
- \u5B89\u5168\u8BC4\u7EA7: A/B/C/D/F

\u5982\u679C\u6CA1\u6709\u53D1\u73B0\u5B89\u5168\u95EE\u9898\uFF0C\u8BF7\u8BF4"\u2705 \u672A\u53D1\u73B0\u5B89\u5168\u6F0F\u6D1E"\u3002\u53EA\u8BC4\u8BBA\u4EE3\u7801\u53D8\u66F4\u3002`;
async function reviewDiff(diff) {
  if (!diff || diff.trim().length === 0) {
    return "\u65E0\u6CD5\u83B7\u53D6\u4EE3\u7801\u53D8\u66F4\u5185\u5BB9\uFF0C\u8BF7\u68C0\u67E5 PR diff\u3002";
  }
  const MAX_DIFF = 3e4;
  const truncated = diff.length > MAX_DIFF ? diff.slice(0, MAX_DIFF) + "\n\n... (diff \u8FC7\u5927\uFF0C\u5DF2\u622A\u65AD)" : diff;
  const userPrompt = `\u8BF7\u5BA1\u67E5\u4EE5\u4E0B\u4EE3\u7801\u53D8\u66F4\uFF1A

\`\`\`diff
${truncated}
\`\`\``;
  const resp = await fetch(`${CONFIG.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CONFIG.apiKey}`
    },
    body: JSON.stringify({
      model: CONFIG.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ],
      max_tokens: CONFIG.maxTokens,
      temperature: 0.1
    })
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`DeepSeek API ${resp.status}: ${err.slice(0, 500)}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "\u5BA1\u67E5\u672A\u751F\u6210\u6709\u6548\u8F93\u51FA";
}
async function postPRComment(prNumber, body) {
  return githubApi(`/issues/${prNumber}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      body: `\u{1F512} **AI \u5B89\u5168\u626B\u63CF\u62A5\u544A** \u2014 SecurityScanner v1.0

${body}

---
<sub>DeepSeek \u9A71\u52A8 | CWE \u5BF9\u9F50 | \u4EC5\u626B\u63CF\u5B89\u5168\u95EE\u9898</sub>`
    })
  });
}
async function createPRReview(prNumber, headSha, comments, summaryBody) {
  if (!comments || comments.length === 0) return null;
  const limited = comments.slice(0, 10);
  return githubApi(`/pulls/${prNumber}/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commit_id: headSha,
      body: `\u{1F512} **\u5B89\u5168\u884C\u5185\u6807\u8BB0** \u2014 \u5171 ${limited.length} \u5904

${summaryBody ? summaryBody.slice(0, 500) : ""}`,
      event: "COMMENT",
      comments: limited
    })
  });
}
async function main() {
  if (!CONFIG.apiKey) throw new Error("\u7F3A\u5C11 API Key!");
  if (!GITHUB.token) throw new Error("\u7F3A\u5C11 GITHUB_TOKEN!");
  console.log("\u{1F512} SecurityScanner v1.0 \u542F\u52A8...");
  console.log(`  \u6A21\u578B: ${CONFIG.model}`);
  const pr = getPRFromEvent();
  console.log(`  PR: #${pr.number} \u2014 ${pr.title}`);
  let diff;
  if (pr.diffUrl) {
    const resp = await fetch(pr.diffUrl, {
      headers: { Authorization: `Bearer ${GITHUB.token}`, Accept: "application/vnd.github.diff" }
    });
    diff = resp.ok ? await resp.text() : "";
  } else {
    const compareData = await githubApi(`/compare/${pr.base}...${pr.head}`);
    diff = compareData.diff || compareData.files?.map((f) => f.patch).join("\n") || "";
  }
  console.log(`  diff: ${diff.length} \u5B57\u7B26`);
  console.log("  AI \u5BA1\u67E5\u4E2D...");
  const review = await reviewDiff(diff);
  console.log(`  \u5BA1\u67E5\u5B8C\u6210 (${review.length} \u5B57)`);
  await postPRComment(pr.number, review);
  console.log("\u2705 \u603B\u7ED3\u8BC4\u8BBA\u5DF2\u53D1\u5E03");
  const findings = parseInlineFindings(review);
  if (findings.length > 0 && pr.headSha) {
    const prData = await githubApi(`/pulls/${pr.number}/files?per_page=50`);
    const changedFiles = prData.map((f) => f.filename);
    const inlineComments = buildInlineComments(findings, changedFiles);
    console.log(`  \u89E3\u6790\u5230 ${findings.length} \u4E2A\u53D1\u73B0\uFF0C${inlineComments.length} \u6761\u53EF\u5B9A\u4F4D\u5230\u4EE3\u7801\u884C`);
    if (inlineComments.length > 0) {
      await createPRReview(pr.number, pr.headSha, inlineComments);
      console.log("\u2705 \u884C\u5185\u8BC4\u8BBA\u5DF2\u53D1\u5E03");
    }
  }
}
main().catch((err) => {
  console.error(`\u274C \u5931\u8D25: ${err.message}`);
  process.exit(1);
});
