import { ApiProperty } from '@nestjs/swagger';

export class MintTransaction {

  @ApiProperty({ description: 'The transaction ID that minted the cat.' })
  transactionId: string;

  @ApiProperty({ description: 'The bitcoin network that was used to mint. Mainnet or Testnet' })
  network: string;

  @ApiProperty({ description: 'The full signed transaction in hex encoded format, so that we can verify that the txn is valid.' })
  transactionHex: string;

  @ApiProperty({ example: 'bc1p...', description: 'The address that funded the transaction (address of the input).' })
  paymentAddress: string;

  @ApiProperty({ example: 'bc1p...', description: 'The address that received the cat (address of the first output).' })
  recipientAddress: string;

  @ApiProperty({ example: '2024-03-01T00:00:00.000Z', description: 'ISO formated string with the exact time when the transaction was signed.' })
  createdAt: Date;
}
