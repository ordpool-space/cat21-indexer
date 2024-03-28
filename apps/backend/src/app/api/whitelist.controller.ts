import { Body, Controller, Get, Header, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { MintTransactionEntitiesService } from '../database-entities/mint-transaction.entities.service';
import { WhitelistEntitiesService } from '../database-entities/whitelist.entities.service';
import { tenSeconds } from '../types/constants';
import { WhitelistStatusResult } from '../types/whitelist-status-result';
import { MintTransaction } from '../types/mint-transaction';


export const schedule = {
  'Developer': {
    start: '2024-03-28T00:00Z',
    maxMintAmount: 15
  },
  'Airdrop': {
    start: '2024-04-10T16:00Z',
    maxMintAmount: 15
  },
  'Super Premint': {
    start: '2024-04-10T16:00Z',
    maxMintAmount: 15
  },
  Premint: {
    start: '2024-04-10T17:00Z',
    maxMintAmount: 10
  },
  Public: {
    start: '2024-04-10T18:00Z',
  }
}

@ApiTags('whitelist')
@Controller()
export class WhitelistController {

  constructor(
    private whitelistEntitiesService: WhitelistEntitiesService,
    private mintTransactionEntitiesService: MintTransactionEntitiesService) {
  }

  /**
   * Friendly whitelist - provides information if a wallet address is eligible to mint
   *
   * The whitelist levels are:
   * - Airdrop - one free cat delivered by us, no action required
   * - Super Premint - up to 15 cats can be minted two hours earlier, Aidrop level can also mint 15 cats at this time
   * - Premint - up to 10 cats can be minted one hour earlier
   * - Public - everyone can mint without any restrictions
   */
  @Get(['whitelist/status/:walletAddress'])
  @ApiOperation({ operationId: 'status' })
  @Header('Cache-Control', 'public, max-age=' + tenSeconds + ', immutable')
  async getStatus(@Param('walletAddress') walletAddress: string): Promise<WhitelistStatusResult> {

    const now = new Date();
    if (now >= new Date(schedule.Public.start)) {

      return {
        walletAddress,
        level: 'Public',
        mintingAllowed: true,
        mintingAllowedAt: schedule.Public.start
      };
    }

    const user = await this.whitelistEntitiesService.findOne(walletAddress);
    const mintCount = user ? await this.mintTransactionEntitiesService.countByRecipientAddress(walletAddress) : 0;



    let mintingAllowed = false;
    let mintingAllowedAt = schedule.Public.start;
    let maxMintAmount = 0;

    if (user) {

      maxMintAmount = schedule[user.level].maxMintAmount;
      mintingAllowedAt = schedule[user.level].start;
      mintingAllowed = mintCount < maxMintAmount && now >= new Date(mintingAllowedAt);
    }

    return {
      walletAddress,
      level: user ? user.level : 'Public',
      mintingAllowed,
      mintingAllowedAt
    };
  }

  /**
   * Friendly mint announcement
   *
   * This method saves all transactions during the premint phase, so that we can update the status
   * We will also have great live stats so that we don't have to search in the mempool
   */
  @Post('whitelist/mintTransaction')
  @ApiOperation({ operationId: 'announceMintTransaction' })
  async announceMintTransaction(@Body() mintTransaction: MintTransaction) {

    // TODO: verify signed txn, so that nobody can block other people by submitting faked txns!
    return this.mintTransactionEntitiesService.save([mintTransaction]);
  }
}
