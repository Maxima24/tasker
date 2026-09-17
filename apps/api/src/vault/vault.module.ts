import { Module } from '@nestjs/common';
import { VaultService } from './vault.service';
import { VaultController } from './vault.controller';
import { AccountImportService } from './account-import.service';

@Module({
  controllers: [VaultController],
  providers: [VaultService, AccountImportService],
  exports: [VaultService],
})
export class VaultModule {}
