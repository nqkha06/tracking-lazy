# NestJS Tracking (Statics) Server

Production-oriented NestJS tracking backend for a link monetization platform.

## Features

- `POST /api/cnt/:alias` high-throughput tracking endpoint
- Redis visit dedupe: `SET visit:{alias}:{ip}:{date} 1 NX EX 86400`
- Device detection (`mobile`, `desktop`, `tablet`)
- Revenue calculation inside NestJS (`rate / 1000`)
- Fake-view short-circuit logic (`7 + tier.bonus`)
- Bitmask detection flags:
  - `1`: `AD_BLOCK`
  - `2`: `PROXY_VPN`
  - `4`: `IP_CHANGE`
- Internal queue logging (`LPUSH logs_queue ...`)
- Background worker:
  - flushes queue to MySQL every 1.5 seconds
  - aggregates minute stats every 60 seconds
  - pushes summary to Laravel (`/internal/stats/update`)
- Retry policy for worker HTTP sync (3 attempts)
- Basic global throttling guard
- Safe multi-instance stat sync via Redis distributed lock

## Tech Stack

- NestJS 11
- MySQL + TypeORM
- Redis + ioredis
- axios
- class-validator

## Project Structure

```txt
src/
  app.module.ts
  main.ts

  modules/
    tracking/
      dto/
        track-request.dto.ts
      tracking.controller.ts
      tracking.service.ts
      tracking.worker.ts
      tracking.repository.ts
      tracking.module.ts
      tracking.types.ts

  redis/
    redis.module.ts
    redis.service.ts

  database/
    database.module.ts

  http/
    http.module.ts
    http.service.ts

  utils/
    device.util.ts
    hash.util.ts
    detection.util.ts

  entities/
    access-log.entity.ts
    user-agent.entity.ts
```

## API

### `POST /api/cnt/:alias`

Sample request:

```bash
curl -X POST http://localhost:3000/api/cnt/demo \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' \
  -d '{"country":"US","adBlock":false,"proxyVpn":false,"ipChange":false}'
```

Sample response:

```json
{
  "ok": true,
  "code": "ACCEPTED",
  "linkId": 123,
  "userId": 456,
  "isEarn": 1,
  "revenue": 0.0005,
  "isFake": false,
  "device": "mobile"
}
```

## Mock Link Data

`TrackingService.getLinkByAlias()` currently uses in-memory mock aliases:

- `demo`: active
- `paused`: inactive

## Database Schema

```sql
CREATE TABLE access_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  link_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  ip_address VARCHAR(45) NOT NULL,
  agent_hash CHAR(32) NOT NULL,
  country VARCHAR(10) NOT NULL DEFAULT 'UNK',
  device TINYINT UNSIGNED NOT NULL,
  revenue DECIMAL(10,6) NOT NULL DEFAULT 0,
  is_earn TINYINT UNSIGNED NOT NULL DEFAULT 0,
  detection_mask INT UNSIGNED NOT NULL DEFAULT 0,
  reject_reason_mask INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  INDEX idx_link_created_at (link_id, created_at),
  INDEX idx_user_created_at (user_id, created_at),
  INDEX idx_ip_created_at (ip_address, created_at)
);

CREATE TABLE user_agents (
  id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  hash CHAR(32) NOT NULL UNIQUE,
  raw TEXT NOT NULL,
  browser VARCHAR(50) NOT NULL DEFAULT 'Unknown',
  os VARCHAR(50) NOT NULL DEFAULT 'Unknown',
  device_type TINYINT UNSIGNED NOT NULL DEFAULT 2
);
```

## Environment

Create `.env`:

```env
PORT=3000

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=tracking
DB_SYNC=false
DB_LOGGING=false
DB_POOL_SIZE=50

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_DB=0
REDIS_PASSWORD=

LOGS_QUEUE_KEY=logs_queue
VISIT_DEDUPE_TTL_SECONDS=86400

LARAVEL_STATS_ENDPOINT=http://localhost:9999/internal/stats/update
HTTP_TIMEOUT_MS=5000
```

## Run

```bash
npm install
npm run build
npm run start:dev
```

## Production Notes

- Disable `DB_SYNC` in production.
- Use Redis cluster/sentinel for HA.
- Run multiple Nest instances behind a load balancer.
- Keep Laravel endpoint internal/private only.
- Use a real link lookup source (replace mock function) before go-live.
