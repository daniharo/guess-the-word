import { Bot, webhookCallback } from "grammy/mod.ts";
import { serve } from "http/server.ts";
import "https://deno.land/x/dotenv@v3.2.2/load.ts";
import { OpenAI } from "https://esm.sh/openai-streams";
import { yieldStream } from "https://esm.sh/yield-stream";
import type { Message } from "https://deno.land/x/grammy_types@v3.1.1/message.ts";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
// const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is not set");
}
// if (!OPENAI_API_KEY) {
//   throw new Error("OPENAI_API_KEY is not set");
// }

const bot = new Bot(BOT_TOKEN, { client: { canUseWebhookReply: () => false } });

// Handle the /start command.
bot.command("start", (ctx) => ctx.reply("Welcome! Up and running."));
// Handle other messages.
bot.on("message:text", async (ctx) => {
  const stream = await OpenAI("chat", {
    model: "gpt-3.5-turbo",
    messages: [{ role: "user", content: ctx.message.text }],
    max_tokens: 100,
  });
  let res = "";
  let message: Message.TextMessage | null = null;
  for await (const chunk of yieldStream(stream)) {
    const decoded = new TextDecoder().decode(chunk);
    res += decoded;
    if (!message) {
      message = await ctx.reply(res);
    } else {
      await ctx.api.editMessageText(message.chat.id, message.message_id, res);
    }
  }
});

const handleUpdate = webhookCallback(bot, "std/http");

if (Deno.env.get("DEV") === "true") {
  try {
    bot.start();
    console.log("Bot is running in development mode");
  } catch {
    console.error("Could not start bot in development mode");
  }
} else {
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
