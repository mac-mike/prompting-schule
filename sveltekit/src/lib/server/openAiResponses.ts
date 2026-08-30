import { marked } from 'marked';
import { OpenAI } from 'openai';
import { OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL } from '$env/static/private';

import { json } from '@sveltejs/kit';
import { stringify } from 'openai/internal/qs/stringify.mjs';

type openAiParams = {
  messages: { role: 'developer' | 'user' | 'assistant'; content: string }[];
  maxTokens?: number;
  reasoningEffort?: 'minimal';
  saveToDb: (text: string, usage: { promptTokens?: number; completionTokens?: number }) => Promise<void>;
};

export type ParsedBirthDate = {
  birthDate: string | null;
  usage: { promptTokens?: number; completionTokens?: number };
};

export async function parseBirthDateWithAi(input: string): Promise<ParsedBirthDate> {
  const client = new AzureOpenAI({
    apiKey: AZURE_KEY,
    endpoint: AZURE_URL,
    apiVersion: AZURE_API_VERSION
  });

  const completion = await client.chat.completions.create({
    model: AZURE_MODEL,
    ...gpt5Verbosity,
    messages: [
      {
        role: 'developer',
        content: 'Du bist ausschließlich ein Datumsparser. Lies das Geburtsdatum aus der Eingabe. Berechne nichts. Antworte ausschließlich mit dem eindeutigen Datum im Format TT.MM.JJJJ oder mit UNKNOWN, wenn kein eindeutiges Geburtsdatum erkennbar ist. Kein weiterer Text.'
      },
      { role: 'user', content: input }
    ],
    max_completion_tokens: 256
  });

  const content = completion.choices[0]?.message.content?.trim() ?? '';
  const match = /\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})\b/.exec(content);
  const birthDate = match
      ? `${match[1].padStart(2, '0')}.${match[2].padStart(2, '0')}.${match[3]}`
      : null;

  return {
    birthDate,
    usage: {
      promptTokens: completion.usage?.prompt_tokens,
      completionTokens: completion.usage?.completion_tokens
    }
  };
}

export async function summarizeConversationMemory(
    previousSummary: string,
    userMessage: string,
    assistantResponse: string
): Promise<string> {
    const client = new AzureOpenAI({
        apiKey: AZURE_KEY,
        endpoint: AZURE_URL,
        apiVersion: AZURE_API_VERSION
    });

    const completion = await client.chat.completions.create({
        model: AZURE_MODEL,
        ...gpt5Verbosity,
        messages: [
            {
                role: 'developer',
                content: 'Erstelle ein kurzes, sachliches Kurzzeitgedächtnis für eine Pizzabestellung. Behalte nur bestätigte Bestelldetails, Ergänzungen, Änderungen. Fasse frühere Angaben zusammen statt sie zu zitieren. Füge keine Informationen hinzu, es muss eine reine Zusammenfassung sein. Höchstens 80 Wörter.'
            },
            {
                role: 'user',
                content: `Bisherige Zusammenfassung:\n${previousSummary || '(keine)'}\n\nNeue Nachricht:\n${userMessage}\n\nAntwort des Assistenten:\n${assistantResponse}`
            }
        ],
        max_completion_tokens: 200
    });

    return completion.choices[0]?.message.content?.trim() || previousSummary;
}

export async function streamAiResponse({ messages, saveToDb, maxTokens = 10000 }: openAiParams) {
  const openaiLLM = new OpenAI({
    apiKey: OPENAI_API_KEY,
    baseURL: OPENAI_BASE_URL,
  });

  let stream;

  try {
    stream = await openaiLLM.responses.create({
      model: OPENAI_MODEL,
      input: messages,
      max_output_tokens: maxTokens,
      reasoning: {
        effort: "low"
      },
      text: {
        verbosity: 'low'
      },
      stream: true
    });
  } catch (err: any) {
    if (err.code === 'content_filter') {
      const errorMessage =
        // json({error: '⚠️ Deine Eingabe konnte leider nicht verarbeitet werden, da sie gegen die Inhaltsrichtlinien verstößt.'});
         '⚠️ Ihre Eingabe konnte leider nicht verarbeitet werden, da sie gegen die Inhaltsrichtlinien verstößt.';

      // Optional: log the actual filtered message for moderation/debugging
      // const userInput = messages.map((m) => `[${m.role}] ${m.content}`).join('\n');

      
      const text = "[Gefiltert]" + stringify(messages);
      // console.log ("error for db:" + text);
      // console.log ("type error for db:" + typeof(text));
      const usage = {
        promptTokens: 0,
        completionTokens: 0
      };

      await saveToDb(text, usage);

      const response = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(errorMessage));
          controller.close();
        }
      });

      return new Response(response, {
        status: 451,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8'
        }
      });
    }

    // Other unexpected errors
    // console.error('Azure OpenAI error:', err);
    throw err;
  }

  let fullText = '';
  let usage: { promptTokens?: number; completionTokens?: number } = {};
  const encoder = new TextEncoder();

  const streamResponse = new ReadableStream({
    async start(controller) {
      for await (const event of stream) {
        // console.log(event);

        if (event.type === 'response.output_text.delta') {
          const delta = (event as any).delta as string | undefined;
          if (delta) {
            fullText += delta;
            controller.enqueue(encoder.encode(delta));
          }
        }

        if (event.type === 'response.completed') {
          const completed = (event as any).response;
          usage = {
            promptTokens: completed?.usage?.input_tokens,
            completionTokens: completed?.usage?.output_tokens
          };
        }
      }

      // Sende Footer
      const footer = JSON.stringify({ __footer: true, ...usage });
      controller.enqueue(encoder.encode('\n[__FOOTER__]' + footer));

      controller.close();

      // Save in DB
      await saveToDb(fullText, usage);
    }
  });

  return new Response(streamResponse, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked'
    }
  });
}
