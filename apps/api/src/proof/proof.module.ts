import { Module } from '@nestjs/common';
import { ProofService } from './proof.service';
import { ProofController } from './proof.controller';

@Module({
  controllers: [ProofController],
  providers: [ProofService],
})
export class ProofModule {}
