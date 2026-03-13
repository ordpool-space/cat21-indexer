import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CatDto {
  @ApiProperty() id!: string;
  @ApiProperty() catNumber!: number;
  @ApiProperty() txHash!: string;
  @ApiProperty() blockHash!: string;
  @ApiProperty() blockHeight!: number;
  @ApiPropertyOptional() mintedAt!: string | null;
  @ApiPropertyOptional() mintedBy!: string | null;
  @ApiProperty() fee!: number;
  @ApiProperty() weight!: number;
  @ApiProperty() feeRate!: number;
  @ApiPropertyOptional() sat!: number | null;
  @ApiPropertyOptional() value!: number | null;
  @ApiPropertyOptional() category!: string | null;
  @ApiProperty() genesis!: boolean;
  @ApiPropertyOptional() catColors!: string[] | null;
  @ApiPropertyOptional() male!: boolean | null;
  @ApiPropertyOptional() female!: boolean | null;
  @ApiPropertyOptional() designIndex!: number | null;
  @ApiPropertyOptional() designPose!: string | null;
  @ApiPropertyOptional() designExpression!: string | null;
  @ApiPropertyOptional() designPattern!: string | null;
  @ApiPropertyOptional() designFacing!: string | null;
  @ApiPropertyOptional() laserEyes!: string | null;
  @ApiPropertyOptional() background!: string | null;
  @ApiPropertyOptional() backgroundColors!: string[] | null;
  @ApiPropertyOptional() crown!: string | null;
  @ApiPropertyOptional() glasses!: string | null;
  @ApiPropertyOptional() glassesColors!: string[] | null;
}

export class CatsPaginatedResultDto {
  @ApiProperty({ type: [CatDto] }) cats!: CatDto[];
  @ApiProperty() total!: number;
  @ApiProperty() currentPage!: number;
  @ApiProperty() itemsPerPage!: number;
}

export class StatusDto {
  @ApiProperty() totalCats!: number;
  @ApiProperty() lastSyncedCatNumber!: number;
}

export class HealthDto {
  @ApiProperty() status!: string;
  @ApiProperty() timestamp!: string;
  @ApiProperty() uptimeSec!: number;
  @ApiProperty() version!: string;
}
