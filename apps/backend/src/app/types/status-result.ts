import { ApiProperty } from '@nestjs/swagger';


export class StatusResult {

  @ApiProperty({ example: 'mainnet', description: 'The network of this status response (mainnet or testnet).' })
  network: 'mainnet' | 'testnet';

  @ApiProperty({ example: 100, description: 'Total number of all indexed CAT-21 ordinals.' })
  indexedCats: number;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z', description: 'ISO formated string with the the time of the last execution of the indexer.' })
  lastSuccessfulExecution: string;

  @ApiProperty({ example: 10000, description: 'The number of seconds the server process has been running.' })
  uptime: number;
}
