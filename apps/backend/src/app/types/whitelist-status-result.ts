import { ApiProperty } from '@nestjs/swagger';


export class WhitelistStatusResult {

  @ApiProperty({ example: 'bc1p...', description: 'The address of this status result.' })
  walletAddress: string;

  @ApiProperty({ example: 'Airdrop', description: 'The whitelist level: Airdrop, Premint, or Public' })
  level: string;

  @ApiProperty({ example: true, description: 'If this returns `false`, then do not allow minting. If this returns `true` then 😻😻😻!' })
  mintingAllowed: boolean;

  @ApiProperty({ example: '2024-03-01T00:00:00.000Z', description: 'ISO formated string with the exact time when the address is allowed to mint.' })
  mintingAllowedAt: string;
}
