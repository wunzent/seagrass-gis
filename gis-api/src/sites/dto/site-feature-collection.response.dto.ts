import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { SiteFeatureResponseDto } from './site-feature.response.dto';

@ApiSchema({ name: 'SiteFeatureCollection' })
export class SiteFeatureCollectionResponseDto {
  @ApiProperty({ enum: ['FeatureCollection'] })
  type!: 'FeatureCollection';

  @ApiProperty({ type: [SiteFeatureResponseDto] })
  features!: SiteFeatureResponseDto[];
}
