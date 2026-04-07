import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity({ name: 'user_agents' })
@Unique('uq_user_agent_hash', ['hash'])
export class UserAgentEntity {
  @PrimaryGeneratedColumn({ type: 'smallint', unsigned: true })
  id!: number;

  @Column({ type: 'char', length: 32 })
  hash!: string;

  @Column({ type: 'text' })
  raw!: string;

  @Column({ type: 'varchar', length: 50, default: 'Unknown' })
  browser!: string;

  @Column({ type: 'varchar', length: 50, default: 'Unknown' })
  os!: string;

  @Column({ name: 'device_type', type: 'tinyint', unsigned: true, default: 2 })
  deviceType!: number;
}
