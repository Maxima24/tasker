import { Module } from '@nestjs/common';
import { TaskersService } from './taskers.service';
import { TaskersController } from './taskers.controller';
import { CapacityService } from './capacity.service';
import { SettingsService } from '../common/settings.service';

@Module({
  controllers: [TaskersController],
  providers: [TaskersService, CapacityService, SettingsService],
  exports: [CapacityService],
})
export class TaskersModule {}
