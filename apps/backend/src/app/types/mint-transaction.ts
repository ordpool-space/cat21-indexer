import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsIn, IsISO8601, Matches } from 'class-validator';

export class MintTransaction {

  @ApiProperty({ description: 'The transaction ID that minted the cat.' })
  @IsNotEmpty({ message: 'Transaction ID cannot be empty.' })
  @Matches(/^[0-9a-fA-F]{64}$/, { message: 'Transaction ID must be a 64-character hexadecimal string.' })
  transactionId: string;

  @ApiProperty({ example: 'mainnet', description: 'The bitcoin network that was used to mint. Possible values: "mainnet" or "testnet"' })
  @IsIn(['mainnet', 'testnet'], { message: 'Network must be either "mainnet" or "testnet".' })
  network: string;

  @ApiProperty({ description: 'The full signed transaction in hex encoded format, so that we can verify that the txn is valid.' })
  @IsNotEmpty({ message: 'Transaction hex cannot be empty.' })
  @Matches(/^\S.*\S$/, { message: 'Transaction hex cannot be only whitespace.' })
  transactionHex: string;

  @ApiProperty({ example: 'bc1p...', description: 'The address that funded the transaction (address of the input).' })
  @IsNotEmpty({ message: 'Payment address cannot be empty.' })
  @Matches(/^\S.*\S$/, { message: 'Payment address cannot be only whitespace.' })
  paymentAddress: string;

  @ApiProperty({ example: 'bc1p...', description: 'The address that received the cat (address of the first output).' })
  @IsNotEmpty({ message: 'Recipient address cannot be empty.' })
  @Matches(/^\S.*\S$/, { message: 'Recipient address cannot be only whitespace.' })
  recipientAddress: string;

  @ApiProperty({ example: '2024-03-01T00:00:00.000Z', description: 'ISO formatted string with the exact time when the transaction was signed.' })
  @IsISO8601({ strict: true }, { message: 'Created at must be a valid ISO-formatted date.' })
  createdAt: Date;
}
