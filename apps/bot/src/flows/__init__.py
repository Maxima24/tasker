"""Multi-step conversations: /new (task intake) and /addaccount.

Everything else in the bot is one tap, one view. These two need several answers
before anything can be sent to the orchestrator, so they keep their progress in
aiogram's FSM between messages.
"""
