import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'access_logs' })
@Index('idx_link_created_at', ['linkId', 'createdAt'])
@Index('idx_user_created_at', ['userId', 'createdAt'])
@Index('idx_ip_created_at', ['ipAddress', 'createdAt'])
export class AccessLogEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'link_id', type: 'int', unsigned: true })
  linkId!: number;

  @Column({ name: 'user_id', type: 'int', unsigned: true })
  userId!: number;

  @Column({ name: 'ip_address', type: 'varchar', length: 45 })
  ipAddress!: string;

  @Column({ name: 'agent_hash', type: 'char', length: 32 })
  agentHash!: string;

  @Column({ name: 'country', type: 'varchar', length: 10, default: 'UNK' })
  country!: string;

  @Column({ name: 'device', type: 'tinyint', unsigned: true })
  device!: number;

  @Column({
    name: 'revenue',
    type: 'decimal',
    precision: 10,
    scale: 6,
    default: 0,
  })
  revenue!: string;

  @Column({ name: 'is_earn', type: 'tinyint', unsigned: true, default: 0 })
  isEarn!: number;

  @Column({ name: 'detection_mask', type: 'int', unsigned: true, default: 0 })
  detectionMask!: number;

  @Column({
    name: 'reject_reason_mask',
    type: 'int',
    unsigned: true,
    default: 0,
  })
  rejectReasonMask!: number;

  @Column({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
