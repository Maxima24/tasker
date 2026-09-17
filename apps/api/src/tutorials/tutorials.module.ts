import { Module } from '@nestjs/common';
import { TutorialsService } from './tutorials.service';
import { OnboardingService } from './onboarding.service';
import { VideoModule } from './video.module';
import { TutorialsController } from './tutorials.controller';
import { CapacityService } from '../taskers/capacity.service';
import { SettingsService } from '../common/settings.service';

@Module({
  imports: [VideoModule],
  controllers: [TutorialsController],
  providers: [
    TutorialsService,
    OnboardingService,
    CapacityService,
    SettingsService,
  ],
  exports: [OnboardingService],
})
export class TutorialsModule {}
