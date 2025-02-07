import * as fs from './fs.js';
import * as github from './github.js';
import * as http from './http.js';
import type { FetchFiles } from '../types.js';

export const sources: Record<string, { fetchFiles: FetchFiles }> = {
  fs,
  github,
  http
};

export const fetchDocuments = async (
  source: keyof typeof sources,
  identifiers: string[],
  options: { repo: string }
) => {
  return sources[source].fetchFiles(identifiers, options);
};
