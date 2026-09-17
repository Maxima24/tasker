import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Channel } from '@prisma/client';

/**
 * Which surface a write arrived from. The bot sets x-tasker-channel: TELEGRAM;
 * everything else is WEB. Section 7 invariant 6 requires this on every event,
 * so it is a first-class request property rather than a per-route argument.
 */
export const ViaChannel = createParamDecorator((_d: unknown, ctx: ExecutionContext): Channel => {
  const header = ctx.switchToHttp().getRequest().headers?.['x-tasker-channel'];
  return header === 'TELEGRAM' ? 'TELEGRAM' : 'WEB';
});
