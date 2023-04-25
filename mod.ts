import { Bot, webhookCallback } from "grammy/mod.ts";
import { Message } from "grammy/types.ts";
import { serve } from "http/server.ts";
import { OpenAI } from "https://esm.sh/openai-streams@^5.1.1";
import "dotenv/load.ts";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN");

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is not set");
}

const bot = new Bot(BOT_TOKEN);

const DECODER = new TextDecoder();

// Handle the /start command.
bot.command("start", (ctx) =>
  ctx.reply("Hey! Send me a message in any language and I'll correct it 🥸")
);
// Handle text messages.
bot.on("message:text", async (ctx) => {
  await ctx.replyWithChatAction("typing");
  const stream = await OpenAI("chat", {
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content:
          "You are a spelling and grammar checker. Given a prompt, reply with the complete corrected prompt in the same language and nothing else.",
      },
      { role: "user", content: ctx.message.text },
    ],
    max_tokens: 500,
  });
  let res = "";
  let message: Message.TextMessage | null = null;
  for await (const chunk of stream) {
    const decoded = DECODER.decode(chunk);
    res += decoded;
    if (!decoded.trim()) {
      continue;
    }
    if (!message) {
      message = await ctx.reply(res);
    } else {
      await ctx.api.editMessageText(message.chat.id, message.message_id, res);
    }
  }
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
