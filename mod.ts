import {
  Bot,
  webhookCallback,
} from "https://deno.land/x/grammy@v1.15.3/mod.ts";
import { serve } from "https://deno.land/std@0.181.0/http/server.ts";
import "https://deno.land/x/dotenv@v3.2.2/load.ts";
import { OpenAI } from "https://deno.land/x/openai@1.3.1/mod.ts";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is not set");
}
if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set");
}

const openAI = new OpenAI(OPENAI_API_KEY);

// Create an instance of the `Bot` class and pass your bot token to it.
const bot = new Bot(BOT_TOKEN); // <-- put your bot token between the ""
// You can now register listeners on your bot object `bot`.
// grammY will call the listeners when users send messages to your bot.

// Handle the /start command.
bot.command("start", (ctx) => ctx.reply("Welcome! Up and running."));
// Handle other messages.
bot.on("message:text", async (ctx) => {
  await ctx.replyWithChatAction("typing");
  const completion = await openAI.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: [{ role: "user", content: ctx.message.text }],
    maxTokens: 100,
  });
  return ctx.reply(completion.choices[0].message.content);
});

// Now that you specified how to handle messages, you can start your bot.
// This will connect to the Telegram servers and wait for messages.

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
