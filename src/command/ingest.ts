import { OpenAI } from '@7-docs/edge/openai';
import { CHUNK_SIZE, OPENAI_EMBEDDING_MODEL } from '@7-docs/shared/constants.js';
import * as fs from '../client/fs.js';
import * as github from '../client/github.js';
import * as http from '../client/http.js';
import { Pinecone } from '../client/pinecone.js';
import { Supabase } from '../client/supabase.js';
import { OPENAI_API_KEY } from '../env.js';
import { generateId } from '../util/crypto.js';
import { extractHtmlSections, isHTML } from '../util/html.js';
import { isMarkdown, extractSections } from '../util/markdown.js';
import ora from '../util/ora.js';
import { extractPdfSections, isPDF } from '../util/pdf.js';
import { extractTextSections } from '../util/text.js';
import { getInitUsage, addTokens } from '../util/usage.js';
import type { MetaData } from '@7-docs/shared';

const sources = {
  github,
  fs,
  http
};

const targets = {
  Pinecone,
  Supabase
};

type Options = {
  source?: string;
  db?: string;
  repo: string;
  patterns: string[];
  namespace: string;
  isDryRun: boolean;
};

export const ingest = async ({ source, repo, patterns, db, namespace, isDryRun }: Options) => {
  if (!source || !(source in sources)) throw new Error(`Invalid --source: ${source}`);
  if (!db || !(db in targets)) throw new Error(`Invalid --db: ${db}`);
  if (source === 'github' && !repo) throw new Error('No --repo provided');

  const client = new OpenAI(OPENAI_API_KEY);

  const spinner = ora(`Fetching files`).start();

  const files = await sources[source as keyof typeof sources].fetchFiles(patterns, repo);

  spinner.succeed();

  if (files.length > 0) {
    const spinner = ora('Creating and upserting vectors').start();

    const DB = new targets[db as keyof typeof targets]();

    const counters = {
      files: files.length,
      vectors: 0,
      usage: getInitUsage()
    };

    try {
      for (const file of files) {
        const { content, url, filePath } = file;

        if (!content) continue;

        spinner.text = `Creating and upserting embedding for: ${filePath}`;

        const { title, sections } = isHTML(filePath)
          ? extractHtmlSections(content, CHUNK_SIZE)
          : isMarkdown(filePath)
          ? extractSections(content, CHUNK_SIZE)
          : isPDF(filePath)
          ? {
              title: filePath,
              sections: (await extractPdfSections(content, CHUNK_SIZE)).map(s => ({ content: s, header: '' }))
            }
          : {
              title: filePath,
              sections: extractTextSections(content, CHUNK_SIZE).map(s => ({ content: s, header: '' }))
            };

        if (isDryRun) continue;

        const requests = sections.map(section =>
          client.createEmbeddings({ input: section.content, model: OPENAI_EMBEDDING_MODEL })
        );
        const responses = await Promise.all(requests);
        const embeddings = responses.flatMap(response => response.embeddings);

        const vectors = embeddings.map((values, index) => {
          const section = sections[index];
          const id = generateId(filePath + '\n' + section.content.trim());
          const metadata: MetaData = { title, url, filePath, content: section.content, header: section.header };
          return { id, values, metadata };
        });

        const insertedVectorCount = await DB.upsertVectors({ namespace, vectors });

        counters.vectors += insertedVectorCount;

        const usages = responses.map(response => response.usage);
        counters.usage = addTokens(counters.usage, usages);
      }

      spinner.succeed('Creating and upserting vectors');
    } catch (error) {
      if (error instanceof Error) spinner.fail(error.message);
      else throw error;
    } finally {
      const messages = [
        `Fetched ${counters.files} file(s) from ${source}`,
        `used ${counters.usage.total_tokens} OpenAI tokens`,
        `upserted ${counters.vectors} vectors to ${db}`
      ];
      ora(messages.join(', ')).info();
    }
  }
};
