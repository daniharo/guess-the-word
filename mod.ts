import {
  Bot,
  session,
  webhookCallback,
  type Context,
  type SessionFlavor,
} from "grammy/mod.ts";
import { Message } from "grammy/types.ts";
import { serve } from "http/server.ts";
import {
  OpenAI,
  type ChatCompletionRequestMessage,
} from "https://esm.sh/openai-streams@5.1.1";
import "dotenv/load.ts";
import { freeStorage } from "https://deno.land/x/grammy_storages@v2.2.0/free/src/mod.ts";
import { throttle } from "https://esm.sh/throttle-debounce@5.0.0";

type SessionData = {
  imitating: string | null;
  messages: ChatCompletionRequestMessage[];
};

function initial(): SessionData {
  return { imitating: null, messages: [] };
}

type MyContext = Context & SessionFlavor<SessionData>;

const BOT_TOKEN = Deno.env.get("BOT_TOKEN");

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is not set");
}

const bot = new Bot<MyContext>(BOT_TOKEN);

bot.use(
  session({
    initial,
    storage: freeStorage<SessionData>(bot.token),
  })
);

const DECODER = new TextDecoder();

// Handle the /start command.
bot.command("start", (ctx) =>
  ctx.reply("Hey! Use the command /imitate <someone> to start 🤩")
);

bot.command("imitate", async (ctx) => {
  const who = ctx.match;
  ctx.session.imitating = who;
  ctx.session.messages = [
    {
      role: "system",
      content: `From now on, you are not an AI. You are ${who}. You have to talk and act as if you are ${who}.`,
    },
  ];
  await ctx.reply(`I'm now imitating ${who}`);
});

// Handle text messages.
bot.on("message:text", async (ctx) => {
  await ctx.replyWithChatAction("typing");
  const who = ctx.session.imitating;
  if (!who) {
    await ctx.reply("You have to use /imitate first");
    return;
  }
  const messages = ctx.session.messages;
  const stream = await OpenAI("chat", {
    model: "gpt-3.5-turbo",
    messages: [...messages, { role: "user", content: ctx.message.text }],
    max_tokens: 500,
  });
  // Edit throttled so that Telegram won't stop the requests.
  const throttledEdit = throttle(
    300,
    (chatId: number, messageId: number, text: string) =>
      ctx.api.editMessageText(chatId, messageId, text)
  );
  let res = "";
  let message: Message.TextMessage | null = null;
  for await (const chunk of stream) {
    const decoded = DECODER.decode(chunk);
    res += decoded;
    // If the trimmed chunk is empty, Bot API would throw an error because
    // the new message is empty or the edited content is the same.
    // Therefore we have to skip the chunk after saving.
    if (!decoded.trim()) {
      continue;
    }
    if (!message) {
      message = await ctx.reply(res);
    } else {
      throttledEdit(message.chat.id, message.message_id, res);
    }
  }
  ctx.session.messages = [
    ...messages,
    { role: "user", content: ctx.message.text },
    { role: "assistant", content: res },
  ];
});

if (Deno.env.get("DEV") === "true") {
  try {
    bot.start();
    console.log("Bot is running in development mode");
  } catch {
    console.error("Could not start bot in development mode");
  }
} else {
  const handleUpdate = webhookCallback(bot, "std/http", {
    timeoutMilliseconds: 25_000,
  });

  serve(async (req) => {
    if (req.method === "POST") {
      const url = new URL(req.url);
      if (url.pathname.slice(1) === bot.token) {
        try {
          return await handleUpdate(req);
        } catch (err) {
          console.error(err);
        }
      }
    }
    return new Response();
  });
}
