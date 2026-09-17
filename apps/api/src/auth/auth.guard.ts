import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { Capability, can, denialMessage } from './capabilities';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Routes a session with a temporary password may still use: me, logout, change it. */
export const ALLOW_DURING_PASSWORD_CHANGE = 'allowDuringPasswordChange';
export const AllowDuringPasswordChange = () => SetMetadata(ALLOW_DURING_PASSWORD_CHANGE, true);

export const REQUIRED_CAPABILITY = 'requiredCapability';
export const RequireCapability = (c: Capability) => SetMetadata(REQUIRED_CAPABILITY, c);

export const REQUIRED_ROLES = 'requiredRoles';
export const RequireRoles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  /** Set when a sub-admin is acting on the admin's behalf (section 14). */
  onBehalfOfId?: string;
}

/**
 * One guard for authentication AND the section 14 matrix. Every request is
 * authorized here, independently of whichever surface sent it.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const req = ctx.switchToHttp().getRequest();
    const token = extractToken(req);

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Sign in to continue.');
    }

    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      if (isPublic) return true;
      throw new UnauthorizedException('Your session has expired. Sign in again.');
    }

    req.user = {
      id: payload.sub,
      role: payload.role as Role,
      name: payload.name,
      onBehalfOfId: payload.onBehalfOfId,
    } satisfies AuthUser;

    if (isPublic) return true;

    // A password somebody else chose (an invite, the first admin) is replaced
    // before anything else happens. Enforced here, not in the browser.
    if (payload.pwc) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_PASSWORD_CHANGE, [
        ctx.getHandler(),
        ctx.getClass(),
      ]);
      if (!allowed) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'PASSWORD_CHANGE_REQUIRED',
          message: 'Choose a new password before continuing.',
        });
      }
    }

    const roles = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (roles?.length && !roles.includes(req.user.role)) {
      throw new ForbiddenException('This area is not available to your role.');
    }

    const capability = this.reflector.getAllAndOverride<Capability>(REQUIRED_CAPABILITY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (capability && !can(req.user.role, capability)) {
      throw new ForbiddenException(denialMessage(capability));
    }

    return true;
  }
}

function extractToken(req: any): string | undefined {
  const header = req.headers?.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7);
  }
  return req.cookies?.tasker_session;
}
