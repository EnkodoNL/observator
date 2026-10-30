// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { analyzeDockerfile } from "./dockerfile";
import { dockerSnippet } from "./snippet";
import { snippetQuestions } from "./snippet-fields";

const APP = "FROM node:26-alpine AS app\nCOPY package*.json ./\n";

function settings(snippet: string) {
  const a = analyzeDockerfile(`${APP}\n${snippet}`, "https://obs.example.com");
  if (!a.ok || !a.existing) throw new Error("no snippet");
  return a.existing;
}

const fields = (s: ReturnType<typeof settings>, answered?: Parameters<typeof snippetQuestions>[1]) =>
  snippetQuestions(s, answered).map((q) => q.field);

describe("snippetQuestions", () => {
  it("has nothing to ask when everything is set", () => {
    const s = settings(
      dockerSnippet("https://obs.example.com", { labels: "app:web", domains: "app.example.com" }),
    );
    expect(fields(s)).toEqual([]);
  });

  it("asks for empty domains and labels, but leaves an empty fail-on alone", () => {
    expect(fields(settings(dockerSnippet("https://obs.example.com")))).toEqual(["domains", "labels"]);
  });

  it("marks what an older snippet did not have yet", () => {
    const old = dockerSnippet("https://obs.example.com", { labels: "app:web" })
      .split("\n")
      .filter((l) => !/OBSERVATOR_(DOMAINS|FAIL_ON)=/.test(l))
      .join("\n");
    expect(snippetQuestions(settings(old))).toMatchObject([
      { field: "domains", arg: "OBSERVATOR_DOMAINS", isNew: true },
      { field: "failOn", arg: "OBSERVATOR_FAIL_ON", isNew: true },
    ]);
  });

  it("does not ask again what was answered, also when the answer is empty", () => {
    expect(fields(settings(dockerSnippet("https://obs.example.com")), ["domains"])).toEqual(["labels"]);
  });
});
