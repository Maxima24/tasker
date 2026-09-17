import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { LoginThrottleService } from './login-throttle.service';
import { BootstrapAdminService } from './bootstrap-admin.service';

@Global()
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'dev-tasker-jwt-secret-change-me',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LoginThrottleService,
    BootstrapAdminService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
