import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { SettingsService } from '../common/settings.service';
import { CapacityService } from '../taskers/capacity.service';
import { OnboardingService } from '../tutorials/onboarding.service';
import { VideoModule } from '../tutorials/video.module';

@Module({
  imports: [VideoModule],
  controllers: [TasksController],
  providers: [TasksService, SettingsService, CapacityService, OnboardingService],
  exports: [TasksService],
})
export class TasksModule {}
