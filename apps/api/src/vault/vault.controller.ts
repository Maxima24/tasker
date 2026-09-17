import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AccountState, Channel } from '@prisma/client';
import { AccountInput, VaultService } from './vault.service';
import { AccountImportService, MAX_IMPORT_BYTES } from './account-import.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser, RequireCapability, RequireRoles } from '../auth/auth.guard';
import { ViaChannel } from '../common/channel.decorator';
import { parsePage } from '../common/pagination';

@Controller('accounts')
export class VaultController {
  constructor(
    private readonly vault: VaultService,
    private readonly importer: AccountImportService,
  ) {}

  // Taskers never browse the pool. They see the one account on their own task,
  // which arrives with the task itself.
  @Get()
  @RequireRoles('ADMIN', 'SUB_ADMIN')
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('worked') worked?: string,
  ) {
    return this.vault.list(
      parsePage(page, limit),
      q,
      worked === 'yes' || worked === 'no' ? worked : undefined,
    );
  }

  @Get('summary')
  @RequireRoles('ADMIN', 'SUB_ADMIN')
  summary() {
    return this.vault.summary();
  }

  @Get(':id')
  @RequireRoles('ADMIN', 'SUB_ADMIN')
  get(@Param('id') id: string) {
    return this.vault.get(id);
  }

  /**
   * The manager's Account Tracker workbook. Without ?commit=1 it only reports
   * what would happen; with it, it does it. Declared before ':id' routes so
   * "import" is never read as an account id.
   */
  @Post('import')
  @RequireCapability('account.create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES } }))
  importSheet(
    @CurrentUser() user: AuthUser,
    @ViaChannel() channel: Channel,
    @UploadedFile() file: any,
    @Query('commit') commit?: string,
    @Body('categories') categories?: string,
  ) {
    let parsed: Record<string, string> | undefined;
    try {
      parsed = categories ? JSON.parse(categories) : undefined;
    } catch {
      parsed = undefined;
    }
    return this.importer.run(user, channel, file, { commit: commit === '1', categories: parsed });
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

  @Post(':id/assignments')
  @RequireCapability('account.updateCredentials')
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { taskerId: string; role?: string; assignedAt?: string },
  ) {
    return this.vault.assign(user, id, body);
  }

  @Post(':id/assignments/:assignmentId/collect')
  @RequireCapability('account.updateCredentials')
  collect(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.vault.collect(user, id, assignmentId);
  }

  @Get(':id/assignments')
  @RequireRoles('ADMIN', 'SUB_ADMIN')
  assignments(@Param('id') id: string) {
    return this.vault.assignmentHistory(id);
  }

  @Get(':id/reveals')
  @RequireRoles('ADMIN', 'SUB_ADMIN')
  reveals(@Param('id') id: string) {
    return this.vault.revealLog(id);
  }
}
