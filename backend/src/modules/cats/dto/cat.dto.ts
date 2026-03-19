import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CatDto {
  @ApiProperty() id!: string;
  @ApiProperty() catNumber!: number;
  @ApiProperty() txHash!: string;
  @ApiProperty() blockHash!: string;
  @ApiProperty() blockHeight!: number;
  @ApiProperty() mintedAt!: string;
  @ApiPropertyOptional() mintedBy!: string | null; // null for OP_RETURN outputs (cat is free)
  @ApiProperty() fee!: number;
  @ApiProperty() weight!: number;
  @ApiProperty() size!: number;
  @ApiProperty() feeRate!: number;
  @ApiProperty() sat!: number;
  @ApiProperty() value!: number;
  @ApiProperty() category!: string;
  @ApiProperty() genesis!: boolean;
  @ApiProperty() catColors!: string[];
  @ApiProperty() male!: boolean;
  @ApiProperty() female!: boolean;
  @ApiProperty() designIndex!: number;
  @ApiProperty() designPose!: string;
  @ApiProperty() designExpression!: string;
  @ApiProperty() designPattern!: string;
  @ApiProperty() designFacing!: string;
  @ApiProperty() laserEyes!: string;
  @ApiProperty() background!: string;
  @ApiProperty() backgroundColors!: string[];
  @ApiProperty() crown!: string;
  @ApiProperty() glasses!: string;
  @ApiProperty() glassesColors!: string[];
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
