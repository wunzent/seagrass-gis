import { Module } from '@nestjs/common';
import { SitesModule } from '../sites/sites.module';
import { SurveysController } from './surveys.controller';
import { DEFAULT_SURVEY_POINTS_LIMIT, SURVEY_POINTS_LIMIT, SurveysRepository } from './surveys.repository';
import { SurveysService } from './surveys.service';

/** Survey history/points and survey writes; uses SitesRepository to lock and read the parent site. */
@Module({
  imports: [SitesModule],
  controllers: [SurveysController],
  providers: [
    SurveysService,
    SurveysRepository,
    { provide: SURVEY_POINTS_LIMIT, useValue: DEFAULT_SURVEY_POINTS_LIMIT },
  ],
})
export class SurveysModule {}
