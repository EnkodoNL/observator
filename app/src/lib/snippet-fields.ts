// SPDX-License-Identifier: FSL-1.1-ALv2
import type { SnippetSettings } from "./dockerfile";

export type SnippetField = "domains" | "labels" | "failOn";

export interface SnippetQuestion {
  field: SnippetField;
  arg: string;
  question: string;
  /** Where the answer may already be, to suggest one instead of asking blind. */
  lookIn: string;
  /** The snippet predates this field, rather than leaving it empty. */
  isNew: boolean;
}

/**
 * The settings worth asking about when a snippet is upgraded. A field added to the snippet that
 * needs a decision gets an entry here. `whenEmpty` asks as long as nothing is set; without it
 * only a snippet that predates the field is asked, because empty is a fine answer.
 */
const FIELDS: (Omit<SnippetQuestion, "isNew"> & { whenEmpty: boolean })[] = [
  {
    field: "domains",
    arg: "OBSERVATOR_DOMAINS",
    question:
      "Which host names is this app served on? Their certificates and registrations are then watched. Leave empty for an app without a public name, such as a worker.",
    lookIn:
      "docker-compose files, reverse proxy config (Caddyfile, Traefik labels, nginx), environment files, and list_domains for names already watched",
    whenEmpty: true,
  },
  {
    field: "labels",
    arg: "OBSERVATOR_LABELS",
    question: "Which labels group this app? Such as app:heatwave,role:web,env:prod.",
    lookIn: "the repository name and the apps in it, and the labels of projects in list_projects",
    whenEmpty: true,
  },
  {
    field: "failOn",
    arg: "OBSERVATOR_FAIL_ON",
    question:
      "Should a build fail on open advisories? low, moderate, high or critical sets the lowest severity that fails it, runtime adds runtime security updates. Leave empty to never fail a build.",
    lookIn: "how the other apps in this repository are set up",
    whenEmpty: false,
  },
];

/** What is still open in an earlier snippet, leaving out what `answered` already settles. */
export function snippetQuestions(old: SnippetSettings, answered: SnippetField[] = []): SnippetQuestion[] {
  return FIELDS.flatMap(({ whenEmpty, ...field }) => {
    const isNew = !old.declared.includes(field.arg);
    const open = !answered.includes(field.field) && !old[field.field] && (whenEmpty || isNew);
    return open ? [{ ...field, isNew }] : [];
  });
}
