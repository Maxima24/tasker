import { Body, Controller, Get, Ip, Param, Post, Query } from '@nestjs/common';
import { AccountState, Channel } from '@prisma/client';
import { AccountInput, VaultService } from './vault.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser, RequireCapability, RequireRoles } from '../auth/auth.guard';
import { ViaChannel } from '../common/channel.decorator';
import { parsePage } from '../common/pagination';

@Controller('accounts')
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  // Taskers never browse the pool. They see the one account on their own task,
  // which arrives with the task itself.
  @Get()
  @RequireRoles('ADMIN', 'SUB_ADMIN')
  list(@Query('page') page?: string, @Query('limit') limit?: string, @Query('q') q?: string) {
    return this.vault.list(parsePage(page, limit), q);
  }

  @Get(':id')
  @RequireRoles('ADMIN', 'SUB_ADMIN')
  get(@Param('id') id: string) {
    return this.vault.get(id);
  }

  @Post()
  @RequireCapability('account.create')
  create(
    @CurrentUser() user: AuthUser,
    @ViaChannel() channel: Channel,
    @Body() body: AccountInput,
  ) {
    return this.vault.create(user, channel, body);
  }

  @Post(':id')
  @RequireCapability('account.updateCredentials')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: AccountInput) {
    return this.vault.update(user, id, body);
  }

  @Post(':id/reveal')
  @RequireCapability('account.reveal')
  reveal(@CurrentUser() user: AuthUser, @Param('id') id: string, @Ip() ip: string) {
    return this.vault.reveal(user, id, ip);
  }

  @Post(':id/state')
  @RequireCapability('account.create')
  setState(
    @Param('id') id: string,
    @Body() body: { state: AccountState; cooldownMinutes?: number },
  ) {
    return this.vault.setState(id, body.state, body.cooldownMinutes);
  }

  @Get(':id/reveals')
  @RequireRoles('ADMIN', 'SUB_ADMIN')
  reveals(@Param('id') id: string) {
    return this.vault.revealLog(id);
  }
}
