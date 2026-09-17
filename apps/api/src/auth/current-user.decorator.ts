import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from './auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
