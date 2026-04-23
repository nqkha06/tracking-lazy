# Tracking API Docs

## Base URL

- Local: `http://localhost:3000`
- Global prefix: `/api`

Full endpoint: `POST /api/cnt/:alias`
Internal stats endpoint: `GET /api/internal/stats/query`

---

## 1) Endpoint

### `POST /api/cnt/:alias`

Track 1 lượt truy cập cho một alias link.

### `GET /api/internal/stats/query`

API nội bộ để Laravel lấy dữ liệu dashboard/statistics trực tiếp từ tracking DB.

Headers (bắt buộc 1 trong 2):

- `X-Internal-Token: {INTERNAL_STATS_API_TOKEN}`
- `Authorization: Bearer {INTERNAL_STATS_API_TOKEN}`

Dùng `GET` với query params.

Query params example:

```json
{
  "created_at_from": "2026-04-01 00:00:00",
  "created_at_to": "2026-04-21 23:59:59",
  "select": ["date", "link_id", "user_agents.browser", "views", "revenue"],
  "group_fields": ["date", "link_id", "user_agents.browser"],
  "where": "[[\"created_at\",\">=\",\"2026-04-01 00:00:00\"],[\"created_at\",\"<\",\"2026-04-22 00:00:00\"],[\"country\",\"IN\",[\"US\",\"VN\"]],[\"device\",\"=\",2]]",
  "country": "US",
  "device": 2,
  "is_earn": 1,
  "order_by": "revenue",
  "order_direction": "desc",
  "limit": 200,
  "page": 1
}
```

Field notes:

- Bắt buộc: `created_at_from`, `created_at_to` (`YYYY-MM-DD` hoặc `YYYY-MM-DD HH:mm:ss`)
- API có 2 mode:
  - `raw` (mặc định): không truyền `group_fields/group_by/groups` -> trả record gốc, không tự group theo `date`
  - `aggregate`: có truyền `group_fields/group_by/groups` -> trả dữ liệu đã group + metrics
- `select`: danh sách cột cần lấy
  - data fields: `created_at`, `date`, `link_id`, `user_id`, `ip_address`, `country`, `device`, `is_earn`, `revenue`, `detection_mask`, `reject_reason_mask`, `user_agents.browser`, `user_agents.os`
  - metric fields: `views`, `revenue`, `earn_views`, `unique_users`, `unique_ips`
  - Không còn hỗ trợ alias cũ: `day`, `clicks`
- `group_fields`: danh sách field group (nếu có)
  - Chỉ khi có `group_fields` thì mới aggregate
  - Nếu truyền `created_at` trong `group_fields` thì hệ thống tự map thành `date(created_at)` (field `date`)
  - Trong aggregate mode, field data trong `select` phải nằm trong `group_fields`
- Raw mode không nhận metric trong `select` (ngoại trừ `revenue` là cột raw của log)
- Field từ bảng quan hệ phải dùng đúng chuẩn `relation.field` (ví dụ: `user_agents.browser`, `user_agents.os`)
- `where`: JSON array điều kiện, hỗ trợ tuple `[field, operator, value]` hoặc object
- Operator hỗ trợ: `=`, `!=`, `<>`, `>`, `>=`, `<`, `<=`, `LIKE`, `NOT LIKE`, `IN`, `NOT IN`, `BETWEEN`, `NOT BETWEEN`
- `user_id`, `link_id`, `country`, `device`, `is_earn`: shortcut filter
- `country`: optional, regex `^[a-zA-Z]{2,10}$`
- `device`: optional (`1=mobile`, `2=desktop`, `3=tablet`)
- `order_by`: field/metric để sort
- `order_direction`: `asc|desc` (mặc định `asc` nếu không truyền)
- `limit`: optional, mặc định `500`, max `5000`
- `page`: optional, mặc định `1`, bắt đầu từ `1`

Examples lấy data nhanh:

```bash
# 1) Raw logs: chỉ lấy vài cột cần thiết
curl -G 'http://localhost:3000/api/internal/stats/query' \
  -H 'X-Internal-Token: change-me' \
  --data-urlencode 'created_at_from=2026-04-18 00:00:00' \
  --data-urlencode 'created_at_to=2026-04-21 23:59:59' \
  --data-urlencode 'select=created_at,link_id,user_id,revenue' \
  --data-urlencode 'order_by=created_at' \
  --data-urlencode 'order_direction=desc' \
  --data-urlencode 'limit=100' \
  --data-urlencode 'page=1'
```

```bash
# 2) Aggregate theo ngày: views + revenue + earn_views
curl -G 'http://localhost:3000/api/internal/stats/query' \
  -H 'X-Internal-Token: change-me' \
  --data-urlencode 'created_at_from=2026-04-01 00:00:00' \
  --data-urlencode 'created_at_to=2026-04-21 23:59:59' \
  --data-urlencode 'select=date,views,revenue,earn_views' \
  --data-urlencode 'group_fields=date' \
  --data-urlencode 'order_by=date' \
  --data-urlencode 'order_direction=asc'
```

```bash
# 3) Aggregate theo link_id: top link theo revenue
curl -G 'http://localhost:3000/api/internal/stats/query' \
  -H 'X-Internal-Token: change-me' \
  --data-urlencode 'created_at_from=2026-04-01 00:00:00' \
  --data-urlencode 'created_at_to=2026-04-21 23:59:59' \
  --data-urlencode 'select=link_id,views,revenue,unique_users' \
  --data-urlencode 'group_fields=link_id' \
  --data-urlencode 'order_by=revenue' \
  --data-urlencode 'order_direction=desc' \
  --data-urlencode 'limit=50' \
  --data-urlencode 'page=2'
```

```bash
# 4) Aggregate theo user_id + link_id, lọc user cụ thể
curl -G 'http://localhost:3000/api/internal/stats/query' \
  -H 'X-Internal-Token: change-me' \
  --data-urlencode 'created_at_from=2026-04-01 00:00:00' \
  --data-urlencode 'created_at_to=2026-04-21 23:59:59' \
  --data-urlencode 'user_id=456' \
  --data-urlencode 'select=user_id,link_id,views,revenue' \
  --data-urlencode 'group_fields=user_id,link_id' \
  --data-urlencode 'order_by=revenue' \
  --data-urlencode 'order_direction=desc'
```

```bash
# 5) Aggregate theo browser (relation field) + country filter
curl -G 'http://localhost:3000/api/internal/stats/query' \
  -H 'X-Internal-Token: change-me' \
  --data-urlencode 'created_at_from=2026-04-01 00:00:00' \
  --data-urlencode 'created_at_to=2026-04-21 23:59:59' \
  --data-urlencode 'select=user_agents.browser,views,revenue' \
  --data-urlencode 'group_fields=user_agents.browser' \
  --data-urlencode 'where=[["country","IN",["VN","US"]],["user_agents.browser","LIKE","%Chrome%"]]' \
  --data-urlencode 'order_by=revenue' \
  --data-urlencode 'order_direction=desc'
```

Response mẫu:

```json
{
  "success": true,
  "code": "STATS_QUERY_OK",
  "message": "ok",
  "generated_at": "2026-04-21T05:20:10.000Z",
  "meta": {
    "timezone": "UTC",
    "mode": "aggregate",
    "query": {
      "created_at_from": "2026-04-01 00:00:00",
      "created_at_to": "2026-04-21 23:59:59",
      "select": ["date", "link_id", "user_agents.browser", "views", "revenue"],
      "group_fields": ["date", "link_id", "user_agents.browser"],
      "order_by": "revenue",
      "order_direction": "desc",
      "limit": 200,
      "page": 1,
      "conditions": [
        { "field": "country", "operator": "IN", "value": ["US", "VN"] }
      ]
    },
    "fields": {
      "date_fields": ["created_at", "date"],
      "filterable_fields": ["created_at", "date", "link_id", "user_id"],
      "selectable_fields": ["created_at", "date", "link_id", "user_id"],
      "relation_fields": ["user_agents.browser", "user_agents.os"]
    },
    "totals": {
      "row_count": 1,
      "total_row_count": 37
    },
    "pagination": {
      "page": 1,
      "per_page": 200,
      "current_page_items": 1,
      "total_items": 37,
      "total_pages": 1,
      "has_next_page": false,
      "has_prev_page": false
    },
    "generated_at": "2026-04-21T05:20:10.000Z"
  },
  "data": {
    "rows": [
      {
        "date": "2026-04-20",
        "link_id": 123,
        "user_agents.browser": "Chrome",
        "views": 18,
        "revenue": 0.032
      }
    ]
  }
}
```

Ghi chú response format:

- Envelope chuẩn production: `success`, `code`, `message`, `generated_at`
- Payload chính nằm trong `data.rows`
- Thông tin query/field/tổng row nằm trong `meta`
- Pagination nằm trong `meta.pagination`
- Key dùng snake_case để đồng bộ với client backend (Laravel/PHP)

### Path params

- `alias` (`string`, required)
- Format hợp lệ: `^[a-zA-Z0-9_-]{3,64}$`

Nếu alias sai format, API trả `code = "INVALID_ALIAS"`.

### Request body (JSON)

Tất cả field đều optional:

```json
{
  "country": "US",
  "adBlock": false,
  "proxyVpn": false,
  "ipChange": false
}
```

- `country`: `string` 2-10 ký tự chữ (`^[a-zA-Z]{2,10}$`), tự convert uppercase. Sai format sẽ fallback `UNK`.
- `adBlock`: `boolean` (chấp nhận cả `"1"/"0"`, `"true"/"false"`, `"yes"/"no"`)
- `proxyVpn`: `boolean`
- `ipChange`: `boolean`

### Headers dùng nội bộ

- `User-Agent`: dùng để detect device + hash UA.
- `X-Forwarded-For`: lấy IP thật (nếu có), phần tử đầu tiên sẽ được dùng.

---

## 2) Response

HTTP status luôn `200 OK` ở flow nghiệp vụ tracking (kể cả reject logic), và phân biệt bằng trường `code`.

### Response schema

```json
{
  "ok": true,
  "code": "ACCEPTED",
  "linkId": 123,
  "userId": 456,
  "isEarn": 1,
  "revenue": 0.0012,
  "isFake": false,
  "device": "desktop"
}
```

- `ok`: `boolean`
- `code`: `string` (xem bảng bên dưới)
- `linkId`: `number` (có khi link hợp lệ)
- `userId`: `number` (có khi link hợp lệ)
- `isEarn`: `0 | 1`
- `revenue`: `number`
- `isFake`: `boolean`
- `device`: `'mobile' | 'desktop' | 'tablet'`

### `code` values

- `ACCEPTED`: hit hợp lệ, đã vào pipeline queue + counter
- `FAKE_VIEW_BYPASS`: trúng fake-view rule, return sớm
- `INVALID_ALIAS`: alias sai format
- `LINK_NOT_FOUND`: không tìm thấy alias
- `LINK_INACTIVE`: link tồn tại nhưng `status != 1`

---

## 3) Business Logic

1. Validate alias format.
2. Load link by alias qua `GET {DETAIL_LINK_ENDPOINT}` (replace `{alias}`).
3. Reject nếu link không tồn tại hoặc `status != 1`.
4. Dedupe Redis theo ngày:
   - Key: `visit:{alias}:{ip}:{YYYYMMDD}`
   - Command: `SET ... NX EX 86400`
5. Detect device từ `User-Agent`:
   - `mobile | desktop | tablet`
6. Revenue:
   - `rate = mobile ? rate.mobile : rate.desktop`
   - `revenue = rate / 1000`
7. Fake view logic:
   - `fakePercent = 7 + tier.bonus`
   - random `1..10000`
   - nếu `roll <= fakePercent * 100` thì bypass earn (`revenue = 0`, `isEarn = 0`)
8. Detection mask:
   - `AD_BLOCK = 1`
   - `PROXY_VPN = 2`
   - `IP_CHANGE = 4`
9. Determine earn:
   - `isEarn = isFirstVisit ? 1 : 0`
   - không earn => `revenue = 0`
10. Realtime Redis stats:

- `HINCRBY stat:minute:{YYYYMMDDHHmm} link:{id}:views 1`
- `HINCRBYFLOAT stat:minute:{YYYYMMDDHHmm} link:{id}:revenue {revenue}`
- `HINCRBYFLOAT stat:minute:{YYYYMMDDHHmm} user:{id}:revenue {revenue}`

11. Push queue log:

- `LPUSH logs_queue {json}`

---

## 4) Queue Log Payload

```json
{
  "link_id": 123,
  "user_id": 456,
  "ip": "1.2.3.4",
  "agent_hash": "md5-user-agent",
  "country": "US",
  "device": 2,
  "revenue": 0.0012,
  "is_earn": 1,
  "detection_mask": 0,
  "reject_reason_mask": 0,
  "created_at": "2026-04-03 15:40:02"
}
```

### `device` mapping

- `1 = mobile`
- `2 = desktop`
- `3 = tablet`

### `reject_reason_mask`

- `1 = LINK_NOT_FOUND`
- `2 = LINK_INACTIVE`
- `4 = FAKE_VIEW`
- `8 = INVALID_ALIAS`

---

## 5) Worker Background Jobs

### Job A: Flush logs queue -> MySQL

- Interval: mỗi `1.5s`
- Batch: tối đa `1000` records/lần
- Redis pop dùng Lua (`LRANGE + LTRIM`) để tránh race condition
- Insert MySQL batch
- Retry tối đa `3` lần
- Nếu fail: push lại queue tail (`RPUSH`) và giữ dữ liệu

### Job B: Aggregate minute stats -> Laravel

- Interval: mỗi `60s`
- Scan keys: `stat:minute:*`
- Bỏ qua key của phút hiện tại
- Aggregate thành payload:

```json
{
  "links": [{ "link_id": 123, "views": 100, "revenue": 0.12 }],
  "users": [{ "user_id": 456, "revenue": 0.5 }],
  "minute_keys": ["202604031540"],
  "generated_at": "2026-04-03T15:41:00.000Z"
}
```

- Sync endpoint: `POST {LARAVEL_STATS_ENDPOINT}`
- Retry HTTP tối đa `3` lần
- Chỉ `DEL stat:minute:*` sau khi sync thành công
- Dùng distributed lock Redis `lock:stats_aggregation` để an toàn multi-instance

---

## 6) Link Detail Lookup

Service gọi endpoint:

- `GET {DETAIL_LINK_ENDPOINT}` (ví dụ: `http://localhost:8000/api/stu/{alias}/details`)

Payload hợp lệ tối thiểu:

```json
{
  "link_id": 123,
  "user_id": 456,
  "level_id": 2,
  "status": 1,
  "rate": {
    "mobile": 0.5,
    "desktop": 1.2
  },
  "tier": {
    "id": 2,
    "bonus": 3
  }
}
```

Service có normalize để chấp nhận một số wrapper phổ biến (`data`, `result`, `link`, `detail`).

---

## 7) Security / Validation

- Basic rate limit global: `600 requests / 60s / IP`.
- ValidationPipe global:
  - `transform: true`
  - `whitelist: true`
  - `forbidNonWhitelisted: true`
- Alias sanitize + regex validation.
- Country sanitize uppercase + fallback `UNK`.
- User-Agent truncate 1024 chars.
- IP normalize (`::ffff:` prefix removed).

---

## 8) Quick Test

### Accepted case

```bash
curl -X POST 'http://localhost:3000/api/cnt/your-alias' \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36' \
  -H 'X-Forwarded-For: 8.8.8.8' \
  -d '{"country":"us","adBlock":false,"proxyVpn":false,"ipChange":false}'
```

### Invalid alias

```bash
curl -X POST 'http://localhost:3000/api/cnt/@@@' -H 'Content-Type: application/json' -d '{}'
```

---

## 9) Demo Dataset

Seed file:

- `docs/sql/20260421_seed_demo_data.sql`

Import:

```bash
mysql -u root -p tracking < docs/sql/20260421_seed_demo_data.sql
```

Expected seeded rows:

- `access_logs`: 24 rows
- `access_logs_daily`: 8 rows
- `user_agents`: 4 rows

Quick query test for internal stats API (GET only):

Raw mode (không group, trả record gốc):

```bash
curl -G 'http://localhost:3000/api/internal/stats/query' \
  -H 'X-Internal-Token: change-me' \
  --data-urlencode 'created_at_from=2026-04-18 00:00:00' \
  --data-urlencode 'created_at_to=2026-04-21 23:59:59' \
  --data-urlencode 'select=created_at,link_id,user_id,ip_address,country,device,is_earn,revenue,user_agents.browser,user_agents.os' \
  --data-urlencode 'where=[["country","IN",["VN","US"]],["device","=",2]]' \
  --data-urlencode 'order_by=created_at' \
  --data-urlencode 'order_direction=desc' \
  --data-urlencode 'limit=200' \
  --data-urlencode 'page=1'
```

Aggregate mode (có group):

```bash
curl -G 'http://localhost:3000/api/internal/stats/query' \
  -H 'X-Internal-Token: change-me' \
  --data-urlencode 'created_at_from=2026-04-18 00:00:00' \
  --data-urlencode 'created_at_to=2026-04-21 23:59:59' \
  --data-urlencode 'select=date,link_id,user_agents.browser,views,revenue' \
  --data-urlencode 'group_fields=date,link_id,user_agents.browser' \
  --data-urlencode 'where=[["country","IN",["VN","US"]],["device","=",2]]' \
  --data-urlencode 'order_by=revenue' \
  --data-urlencode 'order_direction=desc' \
  --data-urlencode 'limit=200' \
  --data-urlencode 'page=1'
```

Form-style params (legacy-compatible) are also supported:

```bash
curl -G 'http://localhost:3000/api/internal/stats/query' \
  -H 'X-Internal-Token: change-me' \
  --data-urlencode 'created_at_from=2026-04-18 00:00:00' \
  --data-urlencode 'created_at_to=2026-04-21 23:59:59' \
  --data-urlencode 'groups[]=date' \
  --data-urlencode 'groups[]=link_id' \
  --data-urlencode 'order_by=revenue' \
  --data-urlencode 'order_direction=desc' \
  --data-urlencode 'limit=100' \
  --data-urlencode 'page=1' \
  --data-urlencode 'filters=[["country","=","VN"],["user_agents.browser","LIKE","%Chrome%"]]'
```

Supported query aliases:

- `created_at_from` / `created_at_to`
- `user_id` / `link_id` (or camelCase `userId` / `linkId`)
- `select` (comma list hoặc lặp param)
- `group_fields` (comma list hoặc lặp param)
- `order_by`, `order_direction`
- `limit`, `page`
- `where` hoặc `filters` JSON array với shape `[field, operator, value]`

Supported data fields (`where`/`group_fields`/`select`):

- `created_at`, `date`, `link_id`, `user_id`, `ip_address`, `country`, `revenue`
- `device`, `is_earn`, `detection_mask`, `reject_reason_mask`, `user_agents.browser`, `user_agents.os`

Supported metric fields (`select`/`order_by`):

- `views`, `revenue`, `earn_views`, `unique_users`, `unique_ips`

Supported operators:

- `=`, `!=`, `<>`, `>`, `>=`, `<`, `<=`, `LIKE`, `NOT LIKE`
- `IN`, `NOT IN`, `BETWEEN`, `NOT BETWEEN`

Notes:

- Fields quan hệ phải dùng dạng `relation.field`: `user_agents.browser`, `user_agents.os`.

## 10) Environment Keys

- `PORT`
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SYNC`, `DB_LOGGING`, `DB_POOL_SIZE`
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_DB`, `REDIS_PASSWORD`
- `LOGS_QUEUE_KEY`
- `VISIT_DEDUPE_TTL_SECONDS`
- `LINK_DETAIL_CACHE_TTL_SECONDS`
- `LARAVEL_STATS_ENDPOINT`
- `DETAIL_LINK_ENDPOINT`
- `INTERNAL_STATS_API_TOKEN`
- `STATS_QUERY_MAX_DAYS`
- `HTTP_TIMEOUT_MS`
