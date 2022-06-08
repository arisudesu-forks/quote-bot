# quote-bot
Telegram quote bot.

Fork of [quote_api](https://github.com/LyoSU/quote-bot) with changes of my preference.

Changes include:
 * Bot adapted to run in containers (Docker)
 * Monitoring via Prometheus
 * Removed advertisements system
 * Deleted donate system
 * Replaced associated bot links with neutral ones
 * Security fix
 * Removed all metrics flooding stderr
 * Added logging of important errors in different places
 * Fixed double encoding of stickers
 * Removed pm2 dependency
 * ... etc
