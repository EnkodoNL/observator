// SPDX-License-Identifier: FSL-1.1-ALv2

export interface OsvEvent {
  introduced?: string;
  fixed?: string;
  last_affected?: string;
  limit?: string;
}

export interface OsvAffected {
  package?: { ecosystem?: string; name?: string };
  ranges?: { type: string; events: OsvEvent[] }[];
  versions?: string[];
}

export interface OsvVuln {
  id: string;
  modified?: string;
  withdrawn?: string;
  aliases?: string[];
  summary?: string;
  details?: string;
  severity?: { type: string; score: string }[];
  affected?: OsvAffected[];
  database_specific?: { severity?: string };
}
