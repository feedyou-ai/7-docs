import { OpenAI } from '../edge/src/openai/v1/client.js';
import { getPrompt } from '../shared/src/prompt.js';
import { supabase } from '../edge/src/index.js';
import { createClient } from '@supabase/supabase-js';
import { MetaData, StreamMetaData } from '../shared/src/types.js';
import type { ChatCompletionRequestMessage } from 'openai';

//@ts-ignore
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

let getCompletionHandler;
import('../edge/src/completion.js').then(abc => {
  getCompletionHandler = abc.getCompletionHandler;
});

import { isChatCompletionModel } from '../edge/src/openai/v1/util.js';
import { getParams, streamResponse } from '../edge/src/util.js';
import { TransformWithEvent } from '../edge/src/util/stream.js';
import { uniqueByProperty } from '../shared/src/array.js';

const { OPENAI_API_KEY, SUPABASE_URL, SUPABASE_API_KEY } = process.env;
const namespace = 'docs';

const app = express();
const port = process.env.PORT || 3000;

if (!SUPABASE_URL) throw new Error('SUPABASE_URL required');
if (!SUPABASE_API_KEY) throw new Error('SUPABASE_API_KEY required');
if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');

const client = createClient(SUPABASE_URL, SUPABASE_API_KEY);

const query = (vector: number[]) => supabase.query({ client, namespace, vector });

const system = '';
const prompt = '';

app.get('/', async (req: any, res: any) => {
  const client = new OpenAI(OPENAI_API_KEY);
  const {
    query: input,
    previousQueries = [],
    previousResponses = [],
    embedding_model = 'text-embedding-ada-002',
    completion_model = 'gpt-3.5-turbo',
    stream = false
  } = {
    query: decodeURIComponent(req.query.query)
    //previousQueries: previousQueries.map(decodeURIComponent),
    //previousResponses: previousResponses.map(decodeURIComponent),
    //embedding_model,
    //completion_model,
    //stream
  };

  if (!input) throw new Error('input required');
  if (!embedding_model) throw new Error('embedding_model required');
  if (!completion_model) throw new Error('completion_model required');

  const { embeddings } = await client.createEmbeddings({
    model: embedding_model,
    input: input + (previousQueries ? ' ' + previousQueries.join(' ') : '')
  });
  console.log('embedd');
  const [vector] = embeddings;

  const queryResults = await query(vector);
  console.log('query');
  const context = queryResults.map(metadata => metadata.content);
  const finalPrompt = getPrompt({ prompt, context, query: input });

  const uniqueByUrl = uniqueByProperty(queryResults, 'url');
  const metadata: StreamMetaData[] = uniqueByUrl.map(m => ({ title: m.title, url: m.url }));
  const streamWithEvent = new TransformWithEvent({ event: 'metadata', data: JSON.stringify(metadata) });

  if (isChatCompletionModel(completion_model)) {
    const messages: ChatCompletionRequestMessage[] = [];
    if (system) {
      messages.push({
        role: 'system',
        content: system
      });
    }

    if (previousQueries && previousQueries.length > 0) {
      previousQueries.forEach((previousQuery: any, index: any) => {
        messages.push({
          role: 'user',
          content: previousQuery
        });

        if (previousResponses && previousResponses[index]) {
          messages.push({
            role: 'assistant',
            content: previousResponses[index]
          });
        }
      });
    }

    messages.push({
      role: 'user',
      content: finalPrompt
    });

    const body = { model: completion_model, messages, stream: false };
    const completionResponse = await client.chatCompletions(body);
    //console.log('completion', await completionResponse.text());

    if (!completionResponse.body) return new Response();
    if (!stream) {
      const out = await completionResponse.json();
      console.log(out);
      res.json(out);
      //return completionResponse;
    }
    const transformedStream = completionResponse.body.pipeThrough(streamWithEvent.getTransformStream());
    return streamResponse(transformedStream);
  } else {
    const body = { model: completion_model, prompt: finalPrompt };
    const completionResponse = await client.completions(body);
    if (!completionResponse.body) return new Response();
    if (!stream) return completionResponse;
    const transformedStream = completionResponse.body.pipeThrough(streamWithEvent.getTransformStream());
    return streamResponse(transformedStream);
  }
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
