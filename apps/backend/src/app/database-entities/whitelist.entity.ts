import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('whitelist')
export class WhitelistEntity {

  @PrimaryColumn()
  walletAddress: string;

  @Column()
  name: string;

  @Column()
  level: 'Airdrop' | 'Super Premint' | 'Premint' | 'Developer';
}
