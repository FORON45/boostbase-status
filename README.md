# BoostBase status

Checks www.boostbasegg.com every 10 minutes from GitHub Actions and rings Telegram ten times, 30 seconds apart, when a page stops answering (Got it stops it) and sends one message when it comes back. A page counts as down after three failed tries 20 seconds apart. `state.json` keeps the last known state and changes only when something goes down, comes back, or a new month starts.

Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
